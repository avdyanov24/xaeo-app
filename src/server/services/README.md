# services

Business logic. A service receives plain values (never `req` or `res`), calls repositories, and returns plain objects or throws an `HttpError` from `../lib/errors.js`. One file per domain area, named `<area>-service.js`.

## Engines and scans

Two folders hold the pure parts of scanning. They use no database and no HTTP, so they run the same in tests, in a script and in the server.

```
engines/
  engine.js           the Engine interface, the two engine ids (chatgpt, claude) and EngineError
  sample-engine.js    an engine that reads scripted answers from the sample answer set
  sample-answers.js   loads and validates sample-answers.json, matches questions
  sample-answers.json the Northside Plumbing set: 5 questions x 2 engines = 10 answers
scans/
  scan-state.js       the scan lifecycle: queued, running, done, failed, cancelled
  extractor.js        finds the client and competitors in an answer, reads citations, labels it
```

An engine is `{ id, name, ask(question) }`, where `ask` resolves to `{ text, citations }`. A scan only depends on that shape, so a live engine can replace the sample engine without changes to the state machine or the extractor.

`scan-state.js` never mutates a scan: `applyEvent(scan, 'start' | 'complete' | 'fail' | 'cancel' | 'retry')` returns a new one, or throws a 409 `HttpError` when the current state does not accept the event. `recordAnswer` and `progress` track how many of the scan's answers are in.

`extractor.js` matches names as whole words, ignoring case. A client is `Cited` when it is named and one of the citations is on its own domain, `Mentioned` when it is only named, and `Not mentioned` otherwise.
