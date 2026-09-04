# A LEFTOVER experiment in a Flask project — the dependency is not even declared. It only
# matters because it contains the string 'FastAPI(', which is the default marker of
# searchPyFiles. Before E-115 was fixed the recursion looked for that default regardless of
# the marker requested, so THIS file was returned as the Flask entry and the real routes in
# web.py were never analysed. No error, no blind spot: the graph was simply about the wrong file.
from fastapi import FastAPI  # noqa: F401  (unused — kept as the shape that broke detection)

api = FastAPI()
