# Architecture

> Status: in development. This document is filled in as the system is built.

## Overview

Xaeo is a Node.js 22 web app (ES modules, no framework, no build step) that serves a vanilla HTML/CSS/JS frontend and a JSON API, backed by a SQLite database.

## Layer rule

Dependencies point one way: `routes` -> `services` -> `engines` and `db`.

| Layer       | Folder                | Responsibility                                                   | Must not                        |
| ----------- | --------------------- | ---------------------------------------------------------------- | ------------------------------- |
| Routes      | `src/server/routes`   | HTTP only: parse and validate input, call a service, respond     | contain business logic or SQL   |
| Services    | `src/server/services` | Business logic: scans, scoring, detection, recommendations       | touch HTTP requests or responses |
| Engines     | `src/server/engines`  | Adapters for AI engines, all implementing one shared interface   | be called from routes directly  |
| Database    | `src/server/db`       | Schema and repositories                                          | hold business rules             |
| Helpers     | `src/server/lib`      | Small shared utilities                                           | depend on other layers          |
| Frontend    | `src/web`             | Pages, components, styles and scripts                            |                                 |
| API gateway | `src/web/js/api.js`   | The only frontend file that talks to the backend                 |                                 |

## Engine interface

_To be defined: the single interface that the mock, OpenAI and Perplexity engines implement._

## Data model

_To be defined: users, brands, scans, questions, answers, results, recommendations._

## HTTP API

_To be defined._

## Scoring

_To be defined: how mentions and citations become a visibility score._

## Security

_To be defined: password storage, sessions, role checks, input validation, API key handling._
