# src/server

Plain Node.js HTTP server, no framework. Requests flow one way:

```
http/      router, JSON body parsing, response helpers, static file handler
routes/    HTTP only: read params and body, validate, call a service, return the result
services/  business logic; never sees req or res
repositories/  SQL only
lib/       shared helpers with no dependencies on other layers (errors, logger, validation)
```

`index.js` is the process entry point; `app.js` builds the request handler so tests can run it without opening a port. See [docs/architecture.md](../../docs/architecture.md).
