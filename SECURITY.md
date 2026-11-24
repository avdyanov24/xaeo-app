# Security policy

## Supported versions

Security fixes are made on `main` and included in the next release.

## Reporting a vulnerability

Please do not open a public issue. Email **hello@tryxaeo.com** with "Security" in the subject and include:

- what the problem is and what an attacker could do with it,
- steps to reproduce, or a proof of concept,
- the commit or version you tested.

We will confirm we received your report, keep you updated while we work on a fix, and credit you when it ships if you would like.

## What is in place

- Input is validated at the API boundary and request bodies are size-limited.
- Responses carry security headers; unexpected errors never return stack traces.
- The Docker image runs as a non-root user.
- Dependabot tracks dependency, GitHub Actions and base image updates.
