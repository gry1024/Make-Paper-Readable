#!/usr/bin/env python3
"""PaperBridge: initialize or serve an independent paper workspace."""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='command', required=True)
    init = sub.add_parser('init', help='Create config without copying or changing your manuscript')
    init.add_argument('paper', type=Path)
    init.add_argument('--workspace', type=Path, required=True)
    serve = sub.add_parser('serve')
    serve.add_argument('workspace', type=Path)
    serve.add_argument('--port', type=int, default=8765)
    args = ap.parse_args()
    workspace = args.workspace.resolve()
    if args.command == 'init':
        paper = args.paper.resolve(strict=True)
        workspace.mkdir(parents=True, exist_ok=True)
        config = {'paper': os.path.relpath(paper, workspace), 'context_files': {},
                  'paragraph_aliases': {}, 'port': 8765, 'max_tokens': 8192,
                  'temperature': 0.5, 'history_messages': 16}
        with (workspace / 'config.json').open('x', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f'Created {workspace / "config.json"}')
        return
    if not (workspace / 'config.json').exists():
        ap.error('Workspace has no config.json. Run init first.')
    os.environ['PAPERBRIDGE_WORKSPACE'] = str(workspace)
    import server
    sys.argv = [sys.argv[0], '--port', str(args.port)]
    server.main()


if __name__ == '__main__':
    main()
