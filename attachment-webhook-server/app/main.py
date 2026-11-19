"""Gleaner — multi-tenant Gmail attachment webhook + web UI."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, Form, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .config import settings
from .crypto import tenant_hash
from .emailer import send_download_email
from .storage import (
    WebhookPayload,
    delete_item,
    list_items,
    purge_expired,
    read_zip_by_hash,
    save_email,
    validate_download_id,
)
from .users import user_store

settings.validate()
user_store.load()

if settings.RETENTION_DAYS > 0:
    try:
        purge_expired(settings.RETENTION_DAYS)
    except Exception as exc:  # pragma: no cover - startup best effort
        print(f"[RETENTION] purge failed: {exc}")

app = FastAPI(title="Gleaner Webhook", version="3.0.0")

_BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(_BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(_BASE_DIR / "static")), name="static")


# ─── helpers ────────────────────────────────────────────────────────────────

def sign_download(tenant: str, download_id: str, exp: int = 0) -> str:
    msg = f"{tenant}:{download_id}:{exp}".encode()
    return hmac.new(settings.SIGNING_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:32]


def verify_download(tenant: str, download_id: str, sig: str,
                    exp: int | str | None = None) -> bool:
    if exp is None or not sig:
        return False
    try:
        exp_i = int(exp)
    except (TypeError, ValueError):
        return False
    if settings.DOWNLOAD_TTL_HOURS > 0 and exp_i < int(datetime.now().timestamp()):
        return False
    return hmac.compare_digest(sign_download(tenant, download_id, exp_i), sig)


def download_url(tenant: str, download_id: str) -> str:
    ttl = settings.DOWNLOAD_TTL_HOURS
    exp = int((datetime.now() + timedelta(hours=ttl)).timestamp()) if ttl > 0 else 0
    sig = sign_download(tenant, download_id, exp)
    return (
        f"{settings.PUBLIC_BASE_URL}/download/{quote(tenant, safe='')}/{quote(download_id, safe='')}"
        f"?exp={exp}&sig={sig}"
    )


def bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[7:]


def require_user(request: Request, authorization: str | None = Header(default=None)) -> str:
    """Accept either a bearer token (Apps Script) or an owner session (browser)."""
    token = bearer_token(authorization)
    if token:
        user_id = user_store.user_id_for_token(token)
        if not user_id:
            raise HTTPException(401, "invalid token")
        return user_id
    session = _session(request)
    if session:
        return session["user_id"]
    raise HTTPException(401, "missing bearer token or session")


def require_admin(authorization: str | None = Header(default=None)) -> None:
    token = bearer_token(authorization)
    if not token:
        raise HTTPException(401, "missing admin token")
    if not settings.ADMIN_TOKEN or not hmac.compare_digest(token, settings.ADMIN_TOKEN):
        raise HTTPException(403, "invalid admin token")


def _html_error(request: Request, status: int, message: str, code: str):
    """Friendly HTML for browsers; plain JSON for API clients."""
    if "text/html" in request.headers.get("accept", ""):
        return templates.TemplateResponse(
            request=request, name="error.html",
            context={"page_title": "Gleaner — Error", "message": message, "code": code},
            status_code=status,
        )
    return JSONResponse(status_code=status, content={"detail": message})


# ─── admin API ──────────────────────────────────────────────────────────────

class AddUserIn(BaseModel):
    user_id: str


@app.post("/admin/users", dependencies=[Depends(require_admin)])
def add_user(body: AddUserIn):
    try:
        token = user_store.add_user(body.user_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return {"user_id": body.user_id, "token": token}


@app.get("/admin/users", dependencies=[Depends(require_admin)])
def list_users():
    return user_store.list_users()


@app.post("/admin/users/{user_id}/revoke", dependencies=[Depends(require_admin)])
def admin_revoke_user(user_id: str):
    try:
        user_store.revoke_user(user_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return {"revoked": user_id}


@app.post("/admin/users/{user_id}/rotate-token", dependencies=[Depends(require_admin)])
def admin_rotate_token(user_id: str):
    try:
        token = user_store.rotate_token(user_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return {"user_id": user_id, "token": token}


# ─── webhook ────────────────────────────────────────────────────────────────

@app.post("/webhook/gmail-attachments")
def receive_attachments(payload: WebhookPayload, user_id: str = Depends(require_user)):
    saved = save_email(user_id, payload)
    tenant = tenant_hash(user_id)
    url = download_url(tenant, saved.download_id)

    # The registered owner is the default recipient. The payload's "from"
    # address is never trusted; an explicit notifyEmail may override it.
    recipient = payload.notifyEmail or user_id
    send_download_email(recipient, payload.subject, url, saved.zip_size, saved.attachment_count)

    return {
        "downloadUrl": url,
        "zipSize": saved.zip_size,
        "attachmentCount": saved.attachment_count,
        "downloadId": saved.download_id,
    }


# ─── downloads (signed, no login) ───────────────────────────────────────────

@app.get("/download/{tenant}/{download_id}")
def download(request: Request, tenant: str, download_id: str,
             sig: str = Query(...), exp: int = Query(...)):
    if not verify_download(tenant, download_id, sig, exp):
        return _html_error(request, 403,
                           "This download link is invalid or has expired. "
                           "Ask the owner for a new link, or log in to your Gleaner dashboard.",
                           "expired-link")
    if user_store.is_download_revoked(tenant, download_id):
        return _html_error(request, 403, "The owner has revoked this download link.",
                           "revoked-link")
    try:
        validate_download_id(download_id)
        blob = read_zip_by_hash(tenant, download_id)
    except FileNotFoundError:
        return _html_error(request, 404, "That archive was not found. It may have been deleted.",
                           "not-found")
    except ValueError:
        return _html_error(request, 400, "Invalid download link.", "invalid-link")
    safe_name = quote(download_id, safe="")
    return Response(
        content=blob,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}-attachments.zip"},
    )


# ─── user API (bearer, unchanged) ───────────────────────────────────────────

@app.get("/api/downloads")
def api_downloads(user_id: str = Depends(require_user)):
    return [
        {"download_id": i.download_id, "subject": i.subject, "sender": i.sender,
         "date": i.date, "zip_size": i.zip_size, "attachment_count": i.attachment_count,
         "created_at": i.created_at}
        for i in list_items(user_id)
    ]


@app.get("/api/downloads/{download_id}")
def api_download_item(download_id: str, user_id: str = Depends(require_user)):
    for item in list_items(user_id):
        if item.download_id == download_id:
            return {
                "download_id": item.download_id, "subject": item.subject,
                "sender": item.sender, "date": item.date, "zip_size": item.zip_size,
                "attachment_count": item.attachment_count, "created_at": item.created_at,
                "download_url": download_url(tenant_hash(user_id), item.download_id),
            }
    raise HTTPException(404, "not found")


@app.post("/api/downloads/{download_id}/revoke")
def api_revoke_download(download_id: str, user_id: str = Depends(require_user)):
    if not any(i.download_id == download_id for i in list_items(user_id)):
        raise HTTPException(404, "not found")
    user_store.revoke_download(user_id, download_id)
    return {"revoked": download_id}


@app.delete("/api/downloads/{download_id}")
def api_delete_item(download_id: str, user_id: str = Depends(require_user)):
    try:
        delete_item(user_id, download_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found")
    except ValueError:
        raise HTTPException(400, "invalid download id")
    return {"deleted": download_id}


# ─── sessions & CSRF ────────────────────────────────────────────────────────

SESSION_COOKIE = "gleaner_session"
ADMIN_SESSION_COOKIE = "gleaner_admin_session"
LOGIN_CSRF_COOKIE = "gleaner_login_csrf"
SESSION_TTL_HOURS = 24


def _sign_value(body: str) -> str:
    mac = hmac.new(settings.SIGNING_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{body}|{mac}"


def _verify_value(value: str | None) -> list[str] | None:
    if not value:
        return None
    body, _, mac = value.rpartition("|")
    if not body:
        return None
    expected = hmac.new(settings.SIGNING_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(mac, expected):
        return None
    return body.split("|")


def sign_session(user_id: str, exp: int, csrf: str) -> str:
    return _sign_value(f"{user_id}|{exp}|{csrf}")


def read_session(cookie: str | None) -> dict | None:
    parts = _verify_value(cookie)
    if not parts or len(parts) != 3:
        return None
    user_id, exp, csrf = parts
    try:
        exp_i = int(exp)
    except ValueError:
        return None
    if exp_i < int(datetime.now().timestamp()):
        return None
    if user_store.is_user_revoked(user_id):
        return None
    return {"user_id": user_id, "csrf": csrf}


def read_admin_session(cookie: str | None) -> dict | None:
    parts = _verify_value(cookie)
    if not parts or len(parts) != 3 or parts[0] != "admin":
        return None
    try:
        exp_i = int(parts[1])
    except ValueError:
        return None
    if exp_i < int(datetime.now().timestamp()):
        return None
    return {"csrf": parts[2]}


def _session(request: Request) -> dict | None:
    return read_session(request.cookies.get(SESSION_COOKIE))


def _admin_session(request: Request) -> dict | None:
    return read_admin_session(request.cookies.get(ADMIN_SESSION_COOKIE))


def _csrf_ok(session: dict, token: str | None) -> bool:
    return bool(token and hmac.compare_digest(session["csrf"], token))


def _new_login_csrf() -> str:
    return secrets.token_urlsafe(24)


def _set_login_cookie(response: Response, token: str) -> None:
    response.set_cookie(LOGIN_CSRF_COOKIE, token, httponly=False,
                        secure=settings.SECURE_COOKIES, samesite="lax", max_age=600)


def _require_owner(request: Request, authorization: str | None = Header(default=None)) -> str:
    session = _session(request)
    if session:
        return session["user_id"]
    return require_user(authorization)


# ─── login / logout (HTML) ──────────────────────────────────────────────────

@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    csrf = _new_login_csrf()
    response = templates.TemplateResponse(
        request=request, name="login.html",
        context={"page_title": "Gleaner — Sign in", "csrf_token": csrf, "error": None},
    )
    _set_login_cookie(response, csrf)
    return response


@app.post("/login", response_class=HTMLResponse)
def login_submit(request: Request, token: str = Form(""), csrf_token: str = Form("")):
    cookie_csrf = request.cookies.get(LOGIN_CSRF_COOKIE)
    # Browser forms always send the hidden CSRF field and must match the cookie.
    # Simple token-only API clients remain supported for backwards compatibility.
    if csrf_token and (not cookie_csrf or not hmac.compare_digest(cookie_csrf, csrf_token)):
        csrf = _new_login_csrf()
        response = templates.TemplateResponse(
            request=request, name="login.html",
            context={"page_title": "Gleaner — Sign in", "csrf_token": csrf,
                     "error": "Your session expired. Please try again."},
            status_code=403,
        )
        _set_login_cookie(response, csrf)
        return response

    user_id = user_store.user_id_for_token(token)
    if not user_id:
        csrf = _new_login_csrf()
        response = templates.TemplateResponse(
            request=request, name="login.html",
            context={"page_title": "Gleaner — Sign in", "csrf_token": csrf,
                     "error": "That token is not valid. Ask your Gleaner administrator for a new one."},
            status_code=403,
        )
        _set_login_cookie(response, csrf)
        return response

    exp = int((datetime.now() + timedelta(hours=SESSION_TTL_HOURS)).timestamp())
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(SESSION_COOKIE, sign_session(user_id, exp, _new_login_csrf()),
                        httponly=True, secure=settings.SECURE_COOKIES, samesite="lax",
                        max_age=SESSION_TTL_HOURS * 3600)
    response.delete_cookie(LOGIN_CSRF_COOKIE)
    return response


@app.get("/logout")
def logout():
    return RedirectResponse("/login", status_code=303)


@app.post("/ui/logout")
def ui_logout(request: Request, csrf_token: str = Form("")):
    session = _session(request)
    if not session or not _csrf_ok(session, csrf_token):
        return _html_error(request, 403, "Your session expired. Please log in again.", "csrf")
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE)
    return response


# ─── dashboard (HTML) ───────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, notice: str | None = None):
    session = _session(request)
    if not session:
        return RedirectResponse("/login", status_code=303)
    user_id = session["user_id"]
    tenant = tenant_hash(user_id)
    items = [
        {
            "download_id": i.download_id,
            "subject": i.subject,
            "sender": i.sender,
            "date": i.date[:10],
            "zip_size": i.zip_size,
            "size_mb": f"{i.zip_size / 1024 / 1024:.1f}",
            "attachment_count": i.attachment_count,
            "url": download_url(tenant, i.download_id),
        }
        for i in list_items(user_id)
    ]
    return templates.TemplateResponse(
        request=request, name="dashboard.html",
        context={
            "page_title": "Gleaner — My archives",
            "items": items,
            "total_mb": f"{sum(i.zip_size for i in list_items(user_id)) / 1024 / 1024:.1f}",
            "user_email": user_id,
            "csrf_token": session["csrf"],
            "notice": notice,
        },
    )


@app.post("/ui/downloads/{download_id}/revoke")
def ui_revoke_download(request: Request, download_id: str, csrf_token: str = Form("")):
    session = _session(request)
    if not session:
        return RedirectResponse("/login", status_code=303)
    if not _csrf_ok(session, csrf_token):
        return _html_error(request, 403, "Your session expired. Please log in again.", "csrf")
    user_id = session["user_id"]
    if not any(i.download_id == download_id for i in list_items(user_id)):
        return _html_error(request, 404, "That archive was not found.", "not-found")
    user_store.revoke_download(user_id, download_id)
    return RedirectResponse("/?notice=link-revoked", status_code=303)


@app.post("/ui/downloads/{download_id}/delete")
def ui_delete_download(request: Request, download_id: str, csrf_token: str = Form("")):
    session = _session(request)
    if not session:
        return RedirectResponse("/login", status_code=303)
    if not _csrf_ok(session, csrf_token):
        return _html_error(request, 403, "Your session expired. Please log in again.", "csrf")
    try:
        delete_item(session["user_id"], download_id)
    except FileNotFoundError:
        return _html_error(request, 404, "That archive was not found.", "not-found")
    except ValueError:
        return _html_error(request, 400, "Invalid archive id.", "invalid-link")
    return RedirectResponse("/?notice=deleted", status_code=303)


# ─── admin UI ───────────────────────────────────────────────────────────────

def _admin_page(request: Request, **extra):
    session = _admin_session(request)
    context = {
        "page_title": "Gleaner — Admin",
        "users": user_store.list_users(),
        "csrf_token": session["csrf"] if session else "",
        "notice": request.query_params.get("notice"),
        "new_token": None,
    }
    context.update(extra)
    return templates.TemplateResponse(request=request, name="admin.html", context=context)


def _admin_login_page(request: Request, error: str | None = None):
    csrf = _new_login_csrf()
    response = templates.TemplateResponse(
        request=request, name="admin_login.html",
        context={"page_title": "Gleaner — Admin sign in", "csrf_token": csrf, "error": error},
        status_code=403 if error else 200,
    )
    _set_login_cookie(response, csrf)
    return response


@app.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request):
    if not _admin_session(request):
        return _admin_login_page(request)
    return _admin_page(request)


@app.post("/admin/ui/login", response_class=HTMLResponse)
def admin_ui_login(request: Request, token: str = Form(""), csrf_token: str = Form("")):
    cookie_csrf = request.cookies.get(LOGIN_CSRF_COOKIE)
    if not cookie_csrf or not hmac.compare_digest(cookie_csrf, csrf_token):
        return _admin_login_page(request, "Your session expired. Please try again.")
    if not settings.ADMIN_TOKEN or not hmac.compare_digest(token, settings.ADMIN_TOKEN):
        return _admin_login_page(request, "That admin token is not valid.")

    exp = int((datetime.now() + timedelta(hours=SESSION_TTL_HOURS)).timestamp())
    response = RedirectResponse("/admin", status_code=303)
    response.set_cookie(ADMIN_SESSION_COOKIE, _sign_value(f"admin|{exp}|{_new_login_csrf()}"),
                        httponly=True, secure=settings.SECURE_COOKIES, samesite="lax",
                        max_age=SESSION_TTL_HOURS * 3600)
    response.delete_cookie(LOGIN_CSRF_COOKIE)
    return response


@app.post("/admin/ui/logout")
def admin_ui_logout(request: Request, csrf_token: str = Form("")):
    session = _admin_session(request)
    if not session or not _csrf_ok(session, csrf_token):
        return _html_error(request, 403, "Your session expired. Please sign in again.", "csrf")
    response = RedirectResponse("/admin", status_code=303)
    response.delete_cookie(ADMIN_SESSION_COOKIE)
    return response


def _admin_guard(request: Request, csrf_token: str):
    session = _admin_session(request)
    if not session:
        return None, RedirectResponse("/admin", status_code=303)
    if not _csrf_ok(session, csrf_token):
        return None, _html_error(request, 403, "Your session expired. Please sign in again.", "csrf")
    return session, None


@app.post("/admin/ui/users", response_class=HTMLResponse)
def admin_ui_add_user(request: Request, user_id: str = Form(""), csrf_token: str = Form("")):
    session, error = _admin_guard(request, csrf_token)
    if error:
        return error
    try:
        token = user_store.add_user(user_id.strip())
    except ValueError as exc:
        return _admin_page(request, error=str(exc))
    return _admin_page(request, new_token=token, notice="user-created")


@app.post("/admin/ui/users/{user_id}/revoke")
def admin_ui_revoke_user(request: Request, user_id: str, csrf_token: str = Form("")):
    session, error = _admin_guard(request, csrf_token)
    if error:
        return error
    try:
        user_store.revoke_user(user_id)
    except ValueError as exc:
        return _admin_page(request, error=str(exc))
    return RedirectResponse("/admin?notice=user-revoked", status_code=303)


@app.post("/admin/ui/users/{user_id}/rotate-token")
def admin_ui_rotate_token(request: Request, user_id: str, csrf_token: str = Form("")):
    session, error = _admin_guard(request, csrf_token)
    if error:
        return error
    try:
        token = user_store.rotate_token(user_id)
    except ValueError as exc:
        return _admin_page(request, error=str(exc))
    return _admin_page(request, new_token=token, notice="token-rotated")


# ─── health ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "storage": str(settings.STORAGE_ROOT),
        "users": len(user_store.list_users()),
        "auth": "bearer+session",
        "encryption": "fernet/hkdf",
    }
