#!/usr/bin/env python3
"""Scan .tsx files for native <button> elements that contain a <Button> component inside."""
import os, re, sys

ROOT = "/home/z/my-project/src"
issues = []

for dirpath, _, files in os.walk(ROOT):
    for fn in files:
        if not fn.endswith(".tsx"):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
        depth = 0  # nesting depth of native <button> blocks
        open_start = None
        for i, line in enumerate(lines):
            opens = len(re.findall(r"<button\b", line))
            closes = len(re.findall(r"</button>", line))
            # if inside a native button block, check for component <Button
            if depth > 0 and re.search(r"<Button\b", line):
                issues.append((path, i + 1, open_start, line.rstrip()[:160]))
            depth += opens - closes
            if opens > 0 and depth > 0 and open_start is None:
                open_start = i + 1
            if depth <= 0:
                depth = 0
                open_start = None

if not issues:
    print("OK — no nested <Button> inside native <button> found.")
else:
    for path, line_no, opened_at, text in issues:
        print(f"{path}:{line_no} (outer <button> opened at line {opened_at})")
        print(f"    {text}")
    sys.exit(1)
