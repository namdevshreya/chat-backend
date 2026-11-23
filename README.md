# Chat Backend (Node.js + TypeScript, MySQL, Firebase Firestore)

1:1 and group chat backend.

- **MySQL (Prisma)**: users, chats, chat members
- **Firestore**: messages, read receipts, last-seen message per user

## Setup

1. Create the database in MySQL Workbench: `CREATE DATABASE chat_app;`
2. Put your Firebase service account key in the project root as `serviceAccountKey.json` (it is git-ignored, never commit it).
3. Copy `.env.example` to `.env` and set your MySQL password in `DATABASE_URL`.
4. Run:

```bash
npm install
npm run db:push      # creates the tables in MySQL
npm run dev          # http://localhost:3000
```

Optional: `npm run db:migrate` instead of `db:push` to create a migration. `npm run build && npm start` for production.

No Firebase credentials? Start the Firestore emulator and set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` in `.env`.

## Data model

**MySQL**: `users(id, name)`, `chats(id, type DIRECT|GROUP, name, directKey UNIQUE, createdById)`, `chat_members(chatId, userId, role ADMIN|MEMBER)`.
`directKey` (`"<smallerId>_<largerId>"`) is unique, so the same two users can never end up with two 1:1 chats, even with simultaneous requests.

**Firestore**
```
chats/{chatId}/messages/{messageId}   senderId, text, createdAt (server time), editedAt, deleted, readBy{userId: Timestamp}
chats/{chatId}/lastSeen/{userId}      userId, messageId, updatedAt
```

## API

Errors are returned as `{ "error": { "code", "message", "details?" } }` with 400 (validation), 403 (not a member / not allowed), 404, 409.

| # | Method & path | Body / query | Result |
|---|---|---|---|
| 1 | `POST /chat/create` | `{ userAId, userBId }` | `{ chatId, created }` |
| 2 | `POST /chat/:chatId/message/send` | `{ senderId, text }` | the stored message (with server timestamp) |
| 3 | `GET /chat/:chatId/messages?limit=50` | `limit` (1-100, default 50), optional `userId` (membership check), optional `before=<messageId>` (older page) | `{ messages (oldest to newest), hasMore, nextBefore }` |
| 4 | `POST /chat/:chatId/message/:messageId/read` | `{ userId }` | `{ messageId, userId, readAt, alreadyRead }` |
| 5 | `POST /chat/:chatId/lastseen` | `{ userId, messageId }` | `{ chatId, userId, messageId }` |
| 6 | `GET /user/:userId/chats` | | `{ userId, chats: [{ chatId, type, name, memberIds, createdAt }] }` |

Helpers (to test easily): `POST /users {name}`, `GET /users`, `GET /chat/:chatId`, `GET /chat/:chatId/lastseen`, `GET /health`.

### Bonus

| Method & path | Body |
|---|---|
| `POST /group/create` | `{ name, creatorId, memberIds[] }` (creator becomes ADMIN) |
| `PATCH /group/:chatId` | `{ requesterId, name }` (admin only) |
| `POST /group/:chatId/members` | `{ requesterId, userIds[] }` (admin only) |
| `DELETE /group/:chatId/members/:userId` | `{ requesterId }` (admin removes anyone, a member can remove themselves; if the last admin leaves, the oldest member is promoted) |
| `PATCH /chat/:chatId/message/:messageId` | `{ senderId, text }` (sender only, sets `editedAt`) |
| `DELETE /chat/:chatId/message/:messageId` | `{ senderId }` (sender only, soft delete) |

Notes: you cannot mark your own message as read; marking read twice keeps the first read time; `senderId`/`userId` come from the request body because authentication is out of scope for this task.

## Quick test (curl)

```bash
curl -X POST localhost:3000/users -H "Content-Type: application/json" -d '{"name":"Alice"}'
curl -X POST localhost:3000/users -H "Content-Type: application/json" -d '{"name":"Bob"}'
curl -X POST localhost:3000/chat/create -H "Content-Type: application/json" -d '{"userAId":1,"userBId":2}'
curl -X POST localhost:3000/chat/1/message/send -H "Content-Type: application/json" -d '{"senderId":1,"text":"Hello Bob"}'
curl "localhost:3000/chat/1/messages?limit=50"
curl -X POST localhost:3000/chat/1/message/<messageId>/read -H "Content-Type: application/json" -d '{"userId":2}'
curl -X POST localhost:3000/chat/1/lastseen -H "Content-Type: application/json" -d '{"userId":2,"messageId":"<messageId>"}'
curl localhost:3000/user/1/chats
```

(On Windows PowerShell use `curl.exe`, or Postman.)
