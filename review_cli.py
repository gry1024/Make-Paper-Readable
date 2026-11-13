#!/usr/bin/env python3
"""Command line access to review notes, for the revision pass.

    python3 review_cli.py list [--all]            # open notes (or all) in paper order
    python3 review_cli.py show N12
    python3 review_cli.py resolve N12 "处理说明"   # mark done with a resolution
    python3 review_cli.py wontfix N12 "理由"
    python3 review_cli.py reopen N12
"""
import sys
import argparse
import os
import json
import urllib.request

import server


def fmt(n, order):
    head = f"{n['id']} [{server.STATUS_ZH[n['status']]}] {order.get(n['section'], (0, n['section']))[1]}"
    if n.get("anchor"):
        head += f" @{n['anchor']}"
    lines = [head]
    if n.get("quote"):
        lines.append("  引文：" + n["quote"].replace("\n", " "))
    lines += ["  " + ln for ln in n["text"].splitlines()]
    if n.get("resolution"):
        lines.append("  处理说明：" + n["resolution"])
    return "\n".join(lines)


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    cmd, args = argv[0], argv[1:]
    with server.LOCK:
        st = server.read_state()
        order = server.section_order(server.load_paper())
        if cmd == "list":
            notes = [n for n in st["notes"] if "--all" in args or n["status"] == "open"]
            notes.sort(key=lambda n: (order.get(n["section"], (9999, ""))[0], int(n["id"][1:])))
            print("\n\n".join(fmt(n, order) for n in notes) or "（没有意见）")
            return 0
        note = next((n for n in st["notes"] if args and n["id"] == args[0]), None)
        if note is None:
            print("找不到该意见编号")
            return 1
        if cmd == "show":
            print(fmt(note, order))
            return 0
        status = {"resolve": "done", "wontfix": "wontfix", "reopen": "open"}.get(cmd)
        if status is None:
            print(__doc__)
            return 1
        note["status"] = status
        if len(args) > 1:
            note["resolution"] = args[1]
        note["updated"] = server.now()
        payload = json.dumps({"status": status, "resolution": note.get("resolution", "")}).encode()
        url = os.environ.get("PAPERBRIDGE_URL", f"http://127.0.0.1:{server.CFG['port']}")
        req = urllib.request.Request(url + "/api/notes/" + note["id"], data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as response:
            note = json.load(response)
    print(fmt(note, order))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
