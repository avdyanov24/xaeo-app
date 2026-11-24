# services

Business logic. A service receives plain values (never `req` or `res`), calls repositories, and returns plain objects or throws an `HttpError` from `../lib/errors.js`. One file per domain area, named `<area>-service.js`.
