# Server

The Cloudflare Worker the extension talks to, with a D1 database. It signs people in by emailed code, starts, lists and stops alerts, checks the watched classes every minute, emails each watcher when a seat opens or the class fills again, and cleans up once a day.

The endpoints are listed in [`packages/shared/src/Api.ts`](../../packages/shared/src/Api.ts).

## Running it locally

```sh
cd apps/server
pnpm dev          # http://localhost:5173
```

This applies `migrations/` to a local SQLite file, then runs the Worker in workerd, the runtime Cloudflare uses, and reloads as you edit. Nothing is emailed: every email is printed in that terminal.

To sign in from a second terminal:

```sh
curl -X POST http://localhost:5173/sign-in/code -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'
# The code appears in the first terminal.
curl -X POST http://localhost:5173/sign-in -H 'content-type: application/json' \
  -d '{"email":"you@example.com","code":"123456"}'
# {"token":"..."}
curl http://localhost:5173/alerts -H 'authorization: Bearer <token>'
```

The two scheduled jobs do not run by themselves locally. To run one:

```sh
curl 'http://localhost:5173/cdn-cgi/local/scheduled?cron=*+*+*+*+*'     # the check every minute
curl 'http://localhost:5173/cdn-cgi/local/scheduled?cron=0+11+*+*+*'    # the daily cleanup
```

Good to know:

- Subscribing (`POST /alerts` with `{"term":"202702","crn":"33940"}`) and both jobs ask the university's real class search, which every student shares. Run them sparingly.
- To query the local database, `POST` `{"sql":"SELECT * FROM classes"}` to `http://localhost:5173/cdn-cgi/local/explorer/api/d1/database/00000000-0000-4000-8000-000000000000/raw`.
- To start over, delete `apps/server/.cloudflare/state`.
- The tests use a SQLite database in Node and never reach the network.

## Files

```
src/index.ts          The Worker: plugs the server and the jobs into Cloudflare's bindings.
src/server.ts         The whole server as one layer: API handlers, unsubscribe page, CORS.
src/signIn.ts         Sign-in codes, the daily cap on code emails, the sign-in endpoints.
src/tokens.ts         Sign-in tokens, and the middleware that checks them.
src/account.ts        Signing out and deleting the account.
src/alerts.ts         Starting, listing and stopping alerts.
src/termRule.ts       Which terms and dates take alerts.
src/poll.ts           The check every minute, and the emails it sends.
src/cleanup.ts        The daily job.
src/scheduled.ts      Which job each cron trigger starts.
src/unsubscribe.ts    The unsubscribe link in emails, and the page it opens.
src/University.ts     Service: the university's class search.
src/Mailer.ts         Service: sending email, or printing it locally.
src/emails.ts         What every email says.
migrations/           The database tables, as SQL run in order.
test/                 What the tests share: fakes and saved university answers.
cloudflare.config.ts  The Worker's name, cron triggers and bindings.
```

## Deployment

The server runs on the Cloudflare account that holds the `ajinkya.dev` zone, on the Workers Paid plan. Everything is changed with `cf`, from `apps/server`, after `pnpm exec cf auth login`. Nothing deploys from CI.

| What | Name | Set in |
| --- | --- | --- |
| Worker | `getthedamclass`, at `https://api.getthedamclass.ajinkya.dev`. Its `workers.dev` address and preview URLs are off. | `cloudflare.config.ts` |
| D1 database | `getthedamclass`, ID `8ec9fdcd-620b-414f-b468-8278130c41d0` | ID in `cloudflare.config.ts`, tables in `migrations/` |
| Email sending domain | `getthedamclass.ajinkya.dev`. Emails come from `alerts@getthedamclass.ajinkya.dev`. | [set up once](#setting-it-up-on-another-account) |
| Rate-limiting rule | "GetTheDamClass: limit sign-in requests per IP", on the zone | set up once |
| Redirect rule | "GetTheDamClass: send plain HTTP to the API to HTTPS", on the zone | set up once |

### Before changing anything

`cf` changes whichever account it is logged in to. Check it:

```sh
pnpm exec cf auth whoami
pnpm exec cf d1 get 8ec9fdcd-620b-414f-b468-8278130c41d0    # must find "getthedamclass"
```

### Deploying

```sh
pnpm exec cf deploy --dry-run    # MAILER must be "cloudflare", PUBLIC_URL the real address
pnpm exec cf deploy --message "what changed"
```

If the version needs a new migration, apply it first.

### Applying a migration

Add the file to `migrations/`, then:

```sh
pnpm exec cf d1 migrations list 8ec9fdcd-620b-414f-b468-8278130c41d0     # what is not applied yet
pnpm exec cf d1 migrations apply 8ec9fdcd-620b-414f-b468-8278130c41d0
```

The running version keeps using the database until the deploy, so a migration must not break it: add columns and tables, and remove things only in a later migration. A migration that has been applied in production is never edited. Locally, delete `.cloudflare/state` after editing one that has not reached production.

### Going back after a bad deploy

```sh
pnpm exec cf workers deployments list --worker getthedamclass
pnpm exec cf workers deployments create --worker getthedamclass --strategy percentage \
  --versions '[{"version_id":"<the earlier version ID>","percentage":100}]'
```

That puts back the version's code and bindings only. The cron triggers, the domain and the log settings stay as the latest deploy set them. To put back everything, check out the earlier commit and `cf deploy` it.

Do not go back to a version deployed before 19 November 2026, 22:40 UTC: those lack protections the current one has. After going back to any version, check that:

- the unsubscribe page still sends its `Referrer-Policy`, `Content-Security-Policy` and `Cache-Control` headers: `curl -sI "https://api.getthedamclass.ajinkya.dev/unsubscribe?key=x"`
- a request with a made-up `?x=1` shows in the live tail without its query
- `SIGN_IN_EMAILS_PER_DAY` in that commit's dry run is no more than about a third of the account's email limit

Going back does not undo a migration. If the data is damaged, D1 can restore the whole database to any minute of the last 30 days:

```sh
pnpm exec cf d1 time-travel restore 8ec9fdcd-620b-414f-b468-8278130c41d0 --timestamp <ISO 8601 time> --dry-run
```

Drop `--dry-run` to do it. A restore undoes every write since, students' included, and takes the tables back too. Run `migrations list` straight after and apply what is missing.

### Logs

```sh
pnpm exec cf observability tail --worker getthedamclass
```

The server writes one line per request, one per check (`Checked the watched classes:`, with its counts), one per cleanup (`Daily cleanup done.`, at 11:00 UTC), and a warning for every email that could not be sent. Query strings, headers and IP addresses are not stored. Logs are kept for 7 days, under **Logs** on the Worker in the Cloudflare dashboard. Only one live tail runs per login.

**Nobody is told when something breaks.** If the university changes its class search, every check fails: `"failed"` is above zero on every `Checked the watched classes:` line, and no alert goes out. Look at the log now and then, and whenever students say alerts stopped coming.

### Email limits

```sh
pnpm exec cf email-sending limits get    # the daily limit, how many were sent, when it resets
```

The account may send 1,000 emails a day: codes, confirmations and alerts together. The limit rises by itself as the account keeps sending mail that is not bounced or reported. Cloudflare's [limits page](https://developers.cloudflare.com/email-service/platform/limits/) links a form for asking sooner, which is worth doing before a release.

Anyone can ask for a sign-in code without signing in, so the server sends at most **330 code emails a day** (`SIGN_IN_EMAILS_PER_DAY` in `cloudflare.config.ts`). That is a third of the limit and not half, because the cap's day is a UTC day and Cloudflare's is not: a flood either side of midnight UTC can land in one of Cloudflare's days. When Cloudflare raises the limit, raise the cap to about a third of it and deploy.

- Past the cap, asking for a code is refused until midnight UTC. Students already signed in keep getting alerts.
- Past Cloudflare's limit, nobody can sign in until it resets, and a seat alert that fails is lost, not sent later.

The plan includes 3,000 emails a month. Each 1,000 after that costs $0.35 ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).

### Addresses Cloudflare has stopped sending to

After a hard bounce or a spam complaint, Cloudflare [suppresses](https://developers.cloudflare.com/email-service/concepts/suppressions/) the address, and every send to it fails: that student cannot sign in and gets no alerts.

```sh
pnpm exec cf email-sending suppressions list                # or --email <address>
pnpm exec cf email-sending suppressions delete <id>         # the ID from the list, not the address
```

### The certificate

The custom domain's certificate also names the zone's apex, `ajinkya.dev`, and Cloudflare serves it there in place of the zone's universal one. It costs nothing. Removing the custom domain does not delete it: do that under **SSL/TLS** > **Edge Certificates**.

### Setting it up on another account

Done once, in this order. Use the new account's database ID and its zone for `<zone>`.

1. **Database.** Put the ID this prints in `PRODUCTION_DATABASE_ID` in `cloudflare.config.ts`, then apply the migrations.

   ```sh
   pnpm exec cf d1 create --name getthedamclass --primary-location-hint wnam
   ```

2. **Email.** Create the sending domain, which adds six DNS records. `limits get` must then say `"recipient_mode": "arbitrary"`. Then turn off email preview, which keeps a copy of every message, sign-in codes included, for about seven days.

   ```sh
   pnpm exec cf email-sending subdomains create -z <zone> --name getthedamclass.<zone>
   pnpm exec cf email-sending subdomains preview -z <zone> --name getthedamclass.<zone>    # any records missing
   pnpm exec cf email-sending subdomains list -z <zone>                                    # prints the id
   pnpm exec cf email-sending subdomains update <id> -z <zone> --preview-enabled false
   ```

3. **Worker.** Change the domain, `SENDER`, `PUBLIC_URL` and `SIGN_IN_EMAILS_PER_DAY` in `cloudflare.config.ts`, and the server's address in `apps/extension/lib/Api.ts`. Then deploy. The first deploy creates the domain's DNS record and certificate, which takes a few minutes; until then HTTPS fails with a handshake error. If it stops with "This Worker does not exist on your account", run it again.

4. **Rate limit.** Asking for a code and trying one need no sign-in, so this rule stops one client from sending many requests in a row: 10 requests per 10 seconds per IP address, then HTTP 429 for 10 seconds. A free zone allows one such rule. `entrypoint update` replaces every rule in the list, so read the list first and send back any rule already in it.

   ```sh
   pnpm exec cf rulesets entrypoint get http_ratelimit -z <zone>
   pnpm exec cf rulesets entrypoint update http_ratelimit -z <zone> --rules '[{
     "description": "GetTheDamClass: limit sign-in requests per IP",
     "expression": "(http.host eq \"api.getthedamclass.<zone>\" and starts_with(http.request.uri.path, \"/sign-in\"))",
     "action": "block",
     "ratelimit": { "characteristics": ["cf.colo.id", "ip.src"], "period": 10, "requests_per_period": 10, "mitigation_timeout": 10 },
     "enabled": true
   }]'
   ```

5. **HTTPS only.** Without this rule, a request over plain HTTP reaches the Worker and gets an answer. The rule redirects it to HTTPS first, with a 308, which keeps the method. The same warning applies: read the existing rules and send them back with this one.

   ```sh
   pnpm exec cf rulesets entrypoint get http_request_dynamic_redirect -z <zone>
   pnpm exec cf rulesets entrypoint update http_request_dynamic_redirect -z <zone> --rules '[{
     "ref": "getthedamclass_api_https",
     "description": "GetTheDamClass: send plain HTTP to the API to HTTPS",
     "expression": "(http.host eq \"api.getthedamclass.<zone>\" and not ssl)",
     "action": "redirect",
     "action_parameters": { "from_value": {
       "target_url": { "expression": "concat(\"https://\", http.host, http.request.uri.path)" },
       "status_code": 308,
       "preserve_query_string": true
     } },
     "enabled": true
   }]'
   ```
