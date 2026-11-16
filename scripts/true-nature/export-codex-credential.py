"""Publish only the short-lived access credential for the private Teable adapter.

Run with the existing Hermes virtualenv. Hermes owns refresh-token locking and
rotation; refresh tokens never enter the Teable container. No credentials print.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--hermes-source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    sys.path.insert(0, args.hermes_source)
    from hermes_cli.auth_codex import resolve_codex_runtime_credentials
    from agent.codex_headers import codex_account_headers
    credentials = resolve_codex_runtime_credentials()
    if credentials['base_url'] != 'https://chatgpt.com/backend-api/codex':
        raise RuntimeError('Unexpected provider origin; refusing credential handoff')
    token = credentials['api_key']
    payload = token.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    output = Path(args.output)
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = output.with_suffix('.new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'apiKey': token, 'headers': codex_account_headers(token), 'expiresAt': claims['exp']}, stream)
    temporary.replace(output)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Codex credential handoff failed; existing credential retained. Check the provider login.', file=sys.stderr)
        sys.exit(1)
