from __future__ import annotations

from dataclasses import fields, is_dataclass
from enum import Enum
import types
from typing import Any, get_args, get_origin, get_type_hints


def decode_dataclass(cls, value):
    if not isinstance(value, dict):
        raise TypeError(f"Expected mapping for {cls.__name__}")
    hints = get_type_hints(cls)
    return cls(
        **{
            field.name: decode_value(hints.get(field.name, Any), value[field.name])
            for field in fields(cls)
        }
    )


def decode_value(annotation, value):
    if annotation is Any:
        return value
    origin = get_origin(annotation)
    arguments = get_args(annotation)
    if origin in {types.UnionType, getattr(types, "UnionType", object)}:
        if value is None and type(None) in arguments:
            return None
        for candidate in arguments:
            if candidate is type(None):
                continue
            try:
                return decode_value(candidate, value)
            except (TypeError, ValueError, KeyError):
                continue
        return value
    if origin is tuple:
        if not arguments:
            return tuple(value)
        item_type = arguments[0]
        if len(arguments) > 1 and arguments[-1] is not Ellipsis:
            return tuple(
                decode_value(item_annotation, item)
                for item_annotation, item in zip(arguments, value)
            )
        return tuple(decode_value(item_type, item) for item in value)
    if origin is list:
        item_type = arguments[0] if arguments else Any
        return [decode_value(item_type, item) for item in value]
    if origin is dict:
        key_type, value_type = arguments or (Any, Any)
        return {
            decode_value(key_type, key): decode_value(value_type, item)
            for key, item in value.items()
        }
    if isinstance(annotation, type) and issubclass(annotation, Enum):
        return annotation(value)
    if isinstance(annotation, type) and is_dataclass(annotation):
        return decode_dataclass(annotation, value)
    return value

