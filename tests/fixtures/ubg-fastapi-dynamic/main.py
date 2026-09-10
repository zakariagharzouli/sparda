from fastapi import FastAPI

app = FastAPI()

# This value requires execution; it is deliberately outside static resolution.
ROUTES = load_route_configuration()


@app.get("/health")
async def health():
    return {"ok": True}


@app.delete(ROUTES["wipe"])
async def wipe_orders(db=None):
    db.execute("DELETE FROM orders")
    return {"ok": True}
