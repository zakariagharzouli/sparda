from flask import Flask

app = Flask(__name__)


@app.post("/pay")
def pay():
    return {"ok": True}
