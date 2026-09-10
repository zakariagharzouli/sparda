# Parse-only fixture: no application or database is executed by the campaign.
from typing import Annotated
from fastapi import FastAPI, Depends, Security
from sqlalchemy import select, insert, update, delete
from models import Users
from db import session
from auth import current_user

app = FastAPI()


@app.get("/unprotected/{user_id}")
def unprotected(user_id: int):
    return session.execute(select(Users).where(Users.id == user_id))


@app.get("/depends")
def protected(user=Depends(current_user)):
    return session.execute(select(Users).where(Users.id == user.id))


@app.post("/security")
def secure(user=Security(current_user, scopes=["write"])):
    return session.execute(insert(Users).values(owner=user.id))


@app.put("/annotated")
def annotated(user: Annotated[str, Depends(current_user)]):
    return session.execute(update(Users).where(Users.id == user.id).values(active=True))


@app.delete("/decorator", dependencies=[Depends(current_user)])
def remove():
    return session.execute(delete(Users))
