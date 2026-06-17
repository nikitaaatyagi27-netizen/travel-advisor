# MongoDB Atlas Setup (free, ~10 minutes)

The app already runs without a database (in-memory) — but trips vanish on restart. This
guide connects it to **MongoDB Atlas** (free cloud database) so trips are saved forever.
No code changes needed: once `MONGODB_URI` is set, the app switches to MongoDB automatically.

---

## 1. Create a free Atlas account

1. Go to **https://www.mongodb.com/cloud/atlas/register**
2. Sign up (Google sign-in is fine).

## 2. Create a free cluster

1. Choose the **M0 / Free** tier (says "FREE", $0 forever).
2. Pick any cloud provider + a region near you.
3. Click **Create**. Wait ~1–3 minutes for it to provision.

## 3. Create a database user

1. In the left menu: **Database Access** → **Add New Database User**.
2. Auth method: **Password**.
3. Username: e.g. `traveladmin`
4. Password: click **Autogenerate** (or set your own) — **copy it somewhere**.
5. Database User Privileges: **Read and write to any database**.
6. **Add User**.

## 4. Allow your computer to connect

1. Left menu: **Network Access** → **Add IP Address**.
2. For development, click **Allow Access from Anywhere** (`0.0.0.0/0`).
   - This is fine for a personal/dev project. For production you'd restrict it.
3. **Confirm**.

## 5. Get your connection string

1. Left menu: **Database** → on your cluster click **Connect**.
2. Choose **Drivers**.
3. Copy the connection string. It looks like:
   ```
   mongodb+srv://traveladmin:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<password>` with the password from step 3.
5. Add a database name before the `?` — use `travel_advisor`:
   ```
   mongodb+srv://traveladmin:YOURPASS@cluster0.xxxxx.mongodb.net/travel_advisor?retryWrites=true&w=majority
   ```

## 6. Put it in the server's `.env`

Open `server/.env` and set:

```
MONGODB_URI=mongodb+srv://traveladmin:YOURPASS@cluster0.xxxxx.mongodb.net/travel_advisor?retryWrites=true&w=majority
```

## 7. Restart the server

```
cd server
npm start
```

You should see:
```
✅ Connected to MongoDB
🚀 Server listening on http://localhost:4000
```

## 8. Verify it's persisting

Visit **http://localhost:4000/api/health** — it should show:
```json
{ "ok": true, "store": "mongodb" }
```

(If it says `"store": "in-memory"`, the connection failed — check the server logs for the
reason: usually a wrong password, the `<password>` placeholder left in, or the IP
allow-list. The app keeps running in-memory either way.)

Now create a trip, add some pins, **restart the server**, reopen the trip link — the pins
are still there. 🎉

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `store: in-memory` after setup | Password wrong, or `<password>` placeholder not replaced. |
| `querySrv ETIMEOUT` / can't connect | IP not allow-listed (step 4), or firewall blocking. |
| `bad auth` | Database user/password mismatch (step 3). |
| Works locally, not when deployed | Add the host's IP (or `0.0.0.0/0`) to Network Access. |
