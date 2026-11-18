"""Gleaner — multi-tenant Gmail attachment webhook."""
import hashlib
import hmac
import io
import re
import zipfile
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from .config import settings
from .crypto import tenant_hash
from .emailer import send_download_email
from .storage import (
    DownloadItem,
    WebhookPayload,
    delete_item,
    list_items,
    read_zip,
    read_zip_by_hash,
    save_email,
    tenant_dir,
)
from .users import user_store

settings.validate()
user_store.load()

app = FastAPI(title="Gleaner Webhook", version="2.0.0")


# ─── helpers ────────────────────────────────────────────────────────────────

def sign_download(tenant: str, download_id: str) -> str:
    msg = f"{tenant}:{download_id}".encode()
    return hmac.new(settings.SIGNING_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:32]


def verify_download(tenant: str, download_id: str, sig: str) -> bool:
    return hmac.compare_digest(sign_download(tenant, download_id), sig)


def download_url(tenant: str, download_id: str) -> str:
    sig = sign_download(tenant, download_id)
    return f"{settings.PUBLIC_BASE_URL}/download/{tenant}/{download_id}?sig={sig}"


def bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[7:]


def require_user(authorization: str | None = Header(default=None)) -> str:
    token = bearer_token(authorization)
    if not token:
        raise HTTPException(401, "missing bearer token")
    user_id = user_store.user_id_for_token(token)
    if not user_id:
        raise HTTPException(401, "invalid token")
    return user_id


def require_admin(authorization: str | None = Header(default=None)) -> None:
    token = bearer_token(authorization)
    if not token:
        raise HTTPException(401, "missing admin token")
    if not settings.ADMIN_TOKEN or not hmac.compare_digest(token, settings.ADMIN_TOKEN):
        raise HTTPException(403, "invalid admin token")


# ─── admin ──────────────────────────────────────────────────────────────────

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


# ─── webhook ────────────────────────────────────────────────────────────────

@app.post("/webhook/gmail-attachments")
def receive_attachments(payload: WebhookPayload, user_id: str = Depends(require_user)):
    saved = save_email(user_id, payload)
    tenant = tenant_hash(user_id)
    url = download_url(tenant, saved.download_id)

    m = re.search(r"<(.+?)>", payload.from_)
    recipient = m.group(1) if m else payload.from_
    send_download_email(recipient, payload.subject, url, saved.zip_size, saved.attachment_count)

    return {
        "downloadUrl": url,
        "zipSize": saved.zip_size,
        "attachmentCount": saved.attachment_count,
        "downloadId": saved.download_id,
    }


# ─── downloads (signed, no login) ───────────────────────────────────────────

@app.get("/download/{tenant}/{download_id}")
def download(tenant: str, download_id: str, sig: str = Query(...)):
    if not verify_download(tenant, download_id, sig):
        raise HTTPException(403, "invalid signature")
    try:
        blob = read_zip_by_hash(tenant, download_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found")
    return Response(
        content=blob,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{download_id}-attachments.zip"'},
    )


# ─── user API (bearer) ──────────────────────────────────────────────────────

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


@app.delete("/api/downloads/{download_id}")
def api_delete_item(download_id: str, user_id: str = Depends(require_user)):
    try:
        delete_item(user_id, download_id)
    except FileNotFoundError:
        raise HTTPException(404, "not found")
    return {"deleted": download_id}


# ─── dashboard session login ────────────────────────────────────────────────

SESSION_COOKIE = "gleaner_session"
SESSION_TTL_HOURS = 24


def sign_session(user_id: str, exp: int) -> str:
    body = f"{user_id}|{exp}"
    mac = hmac.new(settings.SIGNING_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{body}|{mac}"


def read_session(cookie: str | None) -> str | None:
    if not cookie:
        return None
    parts = cookie.rsplit("|", 1)
    if len(parts) != 2:
        return None
    body, mac = parts
    expected = hmac.new(settings.SIGNING_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(mac, expected):
        return None
    try:
        user_id, exp = body.rsplit("|", 1)
        if int(exp) < int(datetime.now().timestamp()):
            return None
        return user_id
    except ValueError:
        return None


def current_session_user(request: Request) -> str:
    user_id = read_session(request.cookies.get(SESSION_COOKIE))
    if not user_id:
        raise HTTPException(401, "login required")
    return user_id


@app.get("/login", response_class=HTMLResponse)
def login_form():
    return HTMLResponse(
        '<html><body><h1>Gleaner login</h1>'
        '<form method="post" action="/login">'
        '<input name="token" placeholder="API token" style="width:40ch">'
        '<button>Log in</button></form></body></html>'
    )


@app.post("/login")
async def login_submit(request: Request):
    form = await request.form()
    token = form.get("token", "")
    user_id = user_store.user_id_for_token(token)
    if not user_id:
        raise HTTPException(403, "invalid token")
    exp = int((datetime.now() + timedelta(hours=SESSION_TTL_HOURS)).timestamp())
    cookie = sign_session(user_id, exp)
    resp = HTMLResponse('<meta http-equiv="refresh" content="0; url=/">')
    resp.set_cookie(SESSION_COOKIE, cookie, httponly=True, secure=True, samesite="lax")
    return resp


@app.get("/logout")
def logout():
    resp = HTMLResponse('<meta http-equiv="refresh" content="0; url=/login">')
    resp.delete_cookie(SESSION_COOKIE)
    return resp


# ─── dashboard ──────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    user_id = current_session_user(request)
    items = list_items(user_id)
    tenant = tenant_hash(user_id)
    rows = "".join(
        f"<tr><td>{i.date[:10]}</td><td>{i.subject}</td><td>{i.attachment_count}</td>"
        f"<td>{i.zip_size/1024/1024:.1f} MB</td>"
        f"<td><a href=\"{download_url(tenant, i.download_id)}\">download</a></td></tr>"
        for i in items
    )
    total_mb = sum(i.zip_size for i in items) / 1024 / 1024
    return HTMLResponse(
        f"<html><body><h1>{settings.UI_TITLE}</h1>"
        f"<p>{len(items)} items · {total_mb:.1f} MB · <a href=\"/logout\">logout</a></p>"
        f"<table border=1 cellpadding=6><tr><th>Datum</th><th>Onderwerp</th>"
        f"<th>Bijlagen</th><th>Grootte</th><th></th></tr>{rows}</table></body></html>"
    )


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