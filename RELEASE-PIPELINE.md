# Reconciled release pipeline

September 26, 2026. Combines `main`'s collector with the deployed
`consumer-improvements` application. Accounts, admin approval, reviewed-first
discovery, and saved-versus-started plans are preserved.

## Release paths

- Push to `main`: verification → credential check → allowlisted build → current
  main check → Firebase Hosting → exact live-content verification.
- Weekly collection (Monday 06:00 UTC) or manual dispatch on `main`: tests →
  restore state artifact → collect → retain successful state and review report →
  explicitly invoke the reusable release workflow. A failed collection blocks
  its release invocation; bot commits are not used as triggers.
- Feature branches and pull requests: tests only, without deployment secrets.

Only Hosting is deployed, never Firestore rules or authentication settings.
Releases are serialized and refuse a revision superseded on `main`. Firebase CLI
15.31.0 is pinned in CI; screenshots use portable temporary paths.

## Publication boundaries

Only 16 runtime assets plus `release.json` enter `dist/`. The manifest identifies
the commit and SHA-256 hashes. The live check compares every runtime asset,
exercises guest save/reload and the admin gate, and checks development/data paths
return 404. It never writes to the production database.

`backend/data/` stays ignored. Weekly state is retained as an Actions artifact
for 90 days, reports for 30 days, and neither is shipped to Hosting. Artifacts
follow repository permissions and are not secret storage. Only the weekly
directory is uploaded, not local nightly outboxes, sessions or keys. If state
expires, collection starts a new baseline.

Weekly collection produces **unreviewed artifacts**, not Firestore writes. The
existing Mac nightly collector/private approval queue remains unchanged. The raw
JSON browser importer was deliberately not merged: it bypassed review, inferred
prices, and dropped unchanged candidates. The public app still reads the approved
Firestore catalog; unchanged offers remain available. Approved catalog changes
already reach users without a Hosting deployment.

Connecting weekly artifacts to the admin queue later requires a review-envelope
adapter and a separate scoped collector identity—not the deployment credential.

## Deployment credential

Configured September 27, 2026: GitHub repository Actions secret
`FIREBASE_SERVICE_ACCOUNT_TRYWISE_9F8E1` uses the dedicated identity
`github-hosting-deploy@trywise-9f8e1.iam.gserviceaccount.com`. Its only project
roles are Firebase Hosting Admin and API Keys Viewer (required by the Firebase
CLI). The credential was transferred directly to GitHub without a local key file.

For replacement or rotation:

1. Have the cloud owner provision a dedicated Hosting deployment service account
   in `trywise-9f8e1`. Use Firebase Hosting Admin (`roles/firebasehosting.admin`)
   and API Keys Viewer (`roles/serviceusage.apiKeysViewer`). Add any further
   permissions only if specifically required and identified by diagnostics.
   Do not grant Owner/Editor, Firestore write, or authentication-admin access.
   Do not reuse the Firebase Admin SDK account, nightly identity, or local login.
2. Store its JSON credential directly in repository Actions secrets as
   `FIREBASE_SERVICE_ACCOUNT_TRYWISE_9F8E1`. Never paste it in chat or commit it.
3. Run “Deploy to Firebase Hosting” on `main` using manual dispatch. Require the
   final live verification to pass, not merely the upload step.
4. Check `https://trywise-9f8e1.web.app/release.json` for the expected revision.

After replacing the secret, verify a successful release before revoking the old
key. Never revoke the active key merely to remove a downloaded local copy.
The current Hosting action requires a service-account JSON secret. A future
alternative is short-lived Workload Identity Federation with an appropriately
adapted workflow.

References: [Firebase GitHub integration](https://firebase.google.com/docs/hosting/github-integration),
[Hosting action inputs](https://github.com/FirebaseExtended/action-hosting-deploy#options),
[Firebase product roles](https://firebase.google.com/docs/projects/iam/roles-predefined-product).

## Checks and operation

Run `npm run test:unit`, Python tests, consumer/smoke/journey/UX browser suites,
and `npm run test:emulator-suite` against demo Auth/Firestore emulators. Then run
`npm run build` and `npm run test:release`.

```sh
gh run list --repo sohanbotke/trialforge
gh workflow run deploy.yml --repo sohanbotke/trialforge --ref main
```

An authorized manual Hosting-only release can use `npm run deploy`, followed by
`npm run test:release-live`. Missing CI credentials do not justify copying local
login tokens into GitHub.

Collector regressions cover 304 preservation, unchanged candidates, source
failures without false removals, one-time gone events, reappearance, robots-policy
failures/wildcards, and compressed-response limits.
