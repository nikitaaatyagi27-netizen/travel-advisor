# Collaborative Trip Planner — Draft Plan

A real-time, multiplayer layer on top of the existing Travel Advisor app. You and your
friends open a shared trip, each explore the map on your own, and pool the places you
want to visit as shared pins that sync live and are saved for later.

---

## The vision (in one line)

> Open a trip, share the link with friends, everyone browses the map independently, and
> the places you pin appear on everyone's screen instantly — and are still there when you
> come back next week.

---

## Key design decisions (already made)

| Decision | Choice | Why |
|---|---|---|
| **Map model** | **Model B** — independent maps, shared pins | No fighting over the map; everyone explores freely, only the *decisions* (pins) are shared. Solves the "how do people search at the same time?" problem. |
| **Joining** | **Link-based, no login** | Share a link, type a display name, you're in. Fast, frictionless. |
| **Persistence** | **Saved to MongoDB** | Pins survive refresh/restart. Reopen the trip anytime via its link. |
| **Real-time** | **Socket.IO** | Pins + presence push live to everyone in the trip. |
| **Search** | **Keep existing** | The current restaurant/hotel/attraction search stays exactly as-is. |

**The link is the key:** anyone with the trip link can view and edit. That's intended for
planning with friends (the link *is* the access control). No private/invite-only mode for now.

---

## The stack (this is genuinely MERN)

```
React  ──websocket + REST──►  Node + Express  ──►  MongoDB
(frontend)                    (server + Socket.IO)   (trips + pins)
```

- **M**ongoDB — stores trips and their pins
- **E**xpress — REST API (create/load trip) + serves Socket.IO
- **R**eact — existing frontend + new collaborative UI
- **N**ode — the runtime

The database is here because the feature genuinely needs it (saving pins), not to chase a buzzword.

---

## Data model (rough)

One `Trip` document per trip, holding its shared pins and shared itinerary.

```
Trip {
  code:       "x7k2"          // shareable link id (in the URL: /trip/x7k2)
  createdAt:  Date

  pins: [                     // the shared pins area (a bucket — order doesn't matter)
    {
      id:         string
      placeName:  "Cafe Lota"
      lat, lng:   number
      addedBy:    "Priya"     // display name typed on join
      note:       string      // optional (v2)
      votes:      ["Aman"]    // optional (v2)
      category:   "must" | "maybe"   // optional (v3)
      createdAt:  Date
    }
  ],

  itinerary: [                // the shared, ORDERED, co-edited plan (order matters)
    {
      id:         string
      placeName:  "Cafe Lota"
      lat, lng:   number
      addedBy:    "Priya"
      // position in the array = order of the stop; reordering reorders this list
    }
  ]
}
```

Pins are an unordered bucket; the itinerary is an ordered list everyone edits together.
Notes, votes, and categories are extra fields added to a pin as those features land.

---

## Features — what gets built, in order

### v1 — The agreed feature set (build this)

1. **Start / join a trip**
   - "Start a trip" button → creates a trip in the DB, returns a shareable link.
   - Opening a trip link → prompts for a display name, then joins the live room.
   - Existing pins + itinerary load from the database on join.

2. **Presence bar**
   - "👥 You, Priya, Aman are here" with colored avatars.
   - Updates live as people join/leave.

3. **Drop a pin — THE CORE RULE**
   - Click a place (or a map point) → "Add to trip" → it becomes a shared pin.
   - Pin shows **who added it** (colored dot / initial).
   - Syncs live to everyone **and** saves to MongoDB.
   - **A shared pin is added to EVERYONE's map immediately, at its real location.**
   - **But your map NEVER moves on its own.** If Rahul pins Uttarakhand while you're
     looking at Delhi, the pin is placed on your map — you just won't see it on screen
     until you pan/zoom over to it. (Like any off-screen marker on Google Maps.)
   - You travel to a far pin only if YOU choose to: click it in the shortlist, zoom
     out, or follow that friend. No one can hijack your view by pinning somewhere.

4. **Shared pins area (shortlist sidebar)**
   - A list panel mirroring ALL the pins, regardless of where each person's map points.
   - This is how you learn about off-screen pins (e.g. Rahul's Uttarakhand pin shows
     in the list even though it's not on your current screen).
   - Each row: place name, who added it, a small color tag.
   - Click a row → YOUR map flies to that pin (you chose to go look).
   - Remove a pin → syncs + updates the DB for everyone.

5. **Shared editable itinerary — co-edited in real time**
   - A shared, ordered list of stops the whole group builds together.
   - **Multiple people can edit it at the same time** — add a stop, remove a stop,
     reorder (drag), and everyone sees the change live.
   - Pins can be promoted into the itinerary ("add to itinerary").
   - This is the genuinely collaborative, shared-mutable-state part (vs pins, which are
     mostly just "add to a bucket"). Conflict handling: last-write-wins per item for v1,
     with the whole ordered list re-broadcast on each change to keep everyone consistent.

6. **Follow a friend**
   - "Follow Priya" button → your map temporarily mirrors her view (you see what her
     map looks like — same center/zoom, live as she moves).
   - "Stop following" → back to exploring on your own.
   - The elegant bridge between "explore alone" and "look together."

**After v1 you can demo:** two browsers, one trip link → pins appear live on both maps
(without either map auto-moving), a shared pins list, a shared itinerary two people edit
simultaneously, presence, and follow-mode. That's the full "wow."

---

### v2 — Make it a real planner

6. **Vote / react on pins** — 👍 / ❤️ so the group signals "yes, this one."
7. **Pin notes** — attach a comment to a pin ("great rooftop, busy after 8pm").
8. **Lightweight chat** — a message strip to discuss without leaving the app.

---

### v3 — Itinerary polish

9. **Categorize pins** — "must-visit" vs "maybe" buckets.
10. **Group by day** — assign pins to Day 1 / Day 2.
11. **Order into a route** — connect pins into a path with rough distances
    (reuses the route/polyline drawing already built for the photo-trip feature).
12. **Finalize trip** — lock the plan into a clean shareable summary.

---

## How the real-time loop works (mental model)

Every collaborative action follows the same request → broadcast → update pattern:

```
Browser A:  user adds "Cafe Lota"
   → socket.emit("pin:add", { tripCode, pin })

Server:     receives it
   → saves the pin to MongoDB
   → io.to(tripCode).emit("pin:added", pin)   // broadcast to the room

Browsers B & C (in the same room, listening):
   → add the pin to their shortlist + map
```

Once "add a pin" works this way, every other feature (remove, vote, note, presence) is
the same pattern with a different event name. **Rooms** scope the broadcast so updates
only reach people in *that* trip.

---

## Build order (foundation first)

1. **Stand up the server** — Node + Express + MongoDB connection. (Also where API keys
   should eventually move — fixes the current key-exposure problem.)
2. **Add Socket.IO + rooms** — two browser tabs join one room, sync a single test value.
3. **Trips in the DB** — create/load a trip by code; the `/trip/:code` route on the frontend.
4. **Pins** — add/remove pins, synced live and persisted. (The heart of v1.)
5. **Presence + shortlist sidebar.**
6. **Follow-a-friend.**
7. Then v2 / v3 as desired.

---

## Open questions to decide before building

- **Display name vs. avatar colors** — auto-assign a color per person? (Yes, recommended.)
- **Anonymous pin editing** — can anyone remove anyone's pin, or only their own? (v1: anyone, simplest.)
- **Trip expiry** — keep trips forever, or auto-delete after N days of inactivity? (v1: keep forever.)
- **Hosting** — where the Node server + MongoDB will run (e.g. Render/Railway + MongoDB Atlas).

---

## Honest notes

- The value of Socket.IO here is real **because the use case (collaboration) needs real-time** —
  not tech for its own sake. Frame it that way.
- This naturally completes the MERN stack and fixes the API-key exposure as a side effect.
- v1 is genuinely a few focused sessions. The "wow" lives entirely in v1; v2/v3 are polish.
