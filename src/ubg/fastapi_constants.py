"""Bounded CPython-AST registration constants; never execute target code.

This implementation does not import the Tree-sitter frontend or its resolver.
"""
import ast


def registration_path(tree, expression):
    if isinstance(expression, ast.Constant) and isinstance(expression.value, str):
        return expression.value
    receiver = expression.value if isinstance(expression, ast.Subscript) else expression
    if not isinstance(receiver, ast.Name):
        return None
    definitions = [n for n in tree.body if isinstance(n, ast.Assign)
                   and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name)
                   and n.targets[0].id == receiver.id]
    if len(definitions) != 1:
        return None
    definition = definitions[0]
    if (definition.lineno, definition.col_offset) >= (expression.lineno, expression.col_offset):
        return None
    permitted = {id(definition.targets[0])}
    for function in tree.body:
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in function.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            argument = decorator.args[0] if decorator.args else next(
                (kw.value for kw in decorator.keywords if kw.arg == "path"), None)
            if isinstance(argument, ast.Name) and isinstance(definition.value, ast.Constant) and isinstance(definition.value.value, str):
                permitted.add(id(argument))
            elif isinstance(argument, ast.Subscript) and isinstance(argument.value, ast.Name) and isinstance(argument.slice, ast.Constant) and isinstance(argument.slice.value, str):
                permitted.add(id(argument.value))
    for count, node in enumerate(ast.walk(tree)):
        if count >= 50000:
            return None
        if isinstance(node, ast.ImportFrom) and any(n.name == "*" for n in node.names):
            return None
        if isinstance(node, ast.Name):
            if node.id in ("exec", "eval", "globals", "locals", "__import__"):
                return None
            if node.id == receiver.id and id(node) not in permitted:
                return None
    if isinstance(expression, ast.Name):
        value = definition.value
        return value.value if isinstance(value, ast.Constant) and isinstance(value.value, str) else None
    if not isinstance(expression.slice, ast.Constant) or not isinstance(expression.slice.value, str):
        return None
    dictionary = definition.value
    if not isinstance(dictionary, ast.Dict) or len(dictionary.keys) > 64:
        return None
    values = {}
    for key, value in zip(dictionary.keys, dictionary.values):
        if not isinstance(key, ast.Constant) or not isinstance(key.value, str) or not isinstance(value, ast.Constant) or not isinstance(value.value, str):
            return None
        if key.value in values:
            return None
        values[key.value] = value.value
    return values.get(expression.slice.value)
