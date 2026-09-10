from fastapi import Depends, HTTPException
from db import session
from sqlalchemy import select
from models import Users


def token():
    return "parse-only"


def current_user(value=Depends(token)):
    row = session.execute(select(Users))
    if not row:
        raise HTTPException(status_code=403)
    return row
