```
1. FULL SESSION LOAD (request/response):

   Browser                API                 Parser              Disk
     │                     │                    │                   │
     │  GET /sessions/:id  │                    │                   │
     │────────────────────▶│                    │                   │
     │                     │  parseFullSession()│                   │
     │                     │───────────────────▶│  read JSONL       │
     │                     │                    │──────────────────▶│
     │                     │                    │◀──────────────────│
     │                     │◀───────────────────│                   │
     │  EnrichedSession    │   EnrichedSession  │                   │
     │◀────────────────────│                    │                   │


2. LIVE UPDATES (push):

   CLI         Disk        Watcher       Parser     Transport     Browser
    │           │            │             │            │            │
    │  append   │            │             │            │            │
    │──────────▶│            │             │            │            │
    │           │ fs.watch() │             │            │            │
    │           │───────────▶│             │            │            │
    │           │  read new  │             │            │            │
    │           │◀───────────│             │            │            │
    │           │            │ parseLine() │            │            │
    │           │            │────────────▶│            │            │
    │           │            │◀────────────│            │            │
    │           │            │                          │            │
    │           │            │  onMessages(batch)       │            │
    │           │            │─────────────────────────▶│            │
    │           │            │                          │  ws.send() │
    │           │            │                          │───────────▶│
    │           │            │                          │            │


3. SESSION CONTROL (request/response):

   Browser                API              Controller        CLI Process
     │                     │                  │                   │
     │  POST /sessions/    │                  │                   │
     │    :id/resume       │                  │                   │
     │────────────────────▶│  controller()    │                   │
     │                     │─────────────────▶│  spawn/signal     │
     │                     │                  │──────────────────▶│
     │                     │◀─────────────────│                   │
     │  ControlResult      │                  │                   │
     │◀────────────────────│                  │                   │
```
