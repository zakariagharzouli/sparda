# The entry is NOT one of the five candidate names, and NOT at the root — so the
# recursive search is the only thing that can find it (E-115).
from flask import Flask

app = Flask(__name__)


@app.post("/pay")
def pay():
    return {"ok": True}
