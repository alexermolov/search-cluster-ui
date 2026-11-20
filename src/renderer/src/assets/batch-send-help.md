# Batch send — variables & examples

Write templates inside your message. Each placeholder `${...}` is evaluated independently for **every** message before it is encoded and sent.

## Available variables

| Variable | Result |
|---|---|
| `${i}` | Message index (1-based) |
| `${uuid}` | Random UUID v4 |
| `${randInt(min,max)}` | Random integer, inclusive |
| `${randFloat(min,max)}` | Random float |
| `${randBool}` | Random boolean `true` / `false` |
| `${randString(len)}` | Random alphanumeric string |
| `${randHex(len)}` | Random hex string |
| `${randEmail}` | Random email address |
| `${randName}` | Random full name |
| `${now}` | Current timestamp in milliseconds |
| `${nowIso}` | Current ISO-8601 datetime string |
| `${pick('a','b','c')}` | Random pick from the list |

## JSON type control

If an entire JSON property value consists of a single variable and the function returns a **number**, **boolean** or **null**, the property type in the final JSON will match that type. This lets you generate real numeric or boolean fields instead of strings.

```json
{
  "id": "${i}",
  "age": "${randInt(18,65)}",
  "active": "${randBool}",
  "email": "${randEmail}",
  "createdAt": "${nowIso}",
  "role": "${pick('admin','user','guest')}",
  "tags": [
    "${pick('fast','slow')}",
    "${pick('v1','v2','v3')}"
  ]
}
```

In the example above:

* `id` becomes a **number** (because `${i}` returns an integer)
* `age` becomes a **number**
* `active` becomes a **boolean**
* `email`, `createdAt`, `role`, and `tags` items remain **strings**

Partial replacements inside a string always produce a string:

```json
{
  "name": "User #${i} - ${randName()}"
}
```

## Raw string mode

In raw mode the whole text is treated as a plain string, so variables can be placed anywhere:

```
user-${randHex(4)}-${i}@example.com
```

## Thrift mode

Thrift mode accepts a JSON payload first and then serializes it to Thrift binary. You can use variables exactly as in JSON mode inside the JSON payload.
