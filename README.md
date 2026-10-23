# Alpaco CLI

Pull an Alpaco template into files, edit it in your own editor, check it, and push it back for review.

A push never changes the live template. It becomes a **pending change** that someone publishes in Alpaco.

## Install

Requires Node.js 22.12 or later.

```sh
npx @alpaco-email/cli --help          # run without installing
npm install -g @alpaco-email/cli      # or install the `alpaco` command
```

The examples below use `alpaco`. With npx, write `npx @alpaco-email/cli` instead, e.g. `npx @alpaco-email/cli login`.

## Log in

In Alpaco, open your profile page, go to **Personal access token** and click **Generate Token**. Then run:

```sh
alpaco login
```

The token is saved to `~/.config/alpaco/credentials.json`, readable only by you. Tokens don't expire. If Alpaco refuses one, generate a new token and log in again.

In CI, set `ALPACO_TOKEN` instead.

The CLI talks to `platform.alpaco.email`. `ALPACO_HOST` (or `--host`) points it somewhere else, which is only needed when developing Alpaco itself.

## Work on a template

```sh
alpaco list                  # templates you can open, with their ids
alpaco pull [template ID]    # download one into a folder
cd [template name]
# …edit the files…
alpaco validate              # check it before pushing
alpaco diff                  # what pushing would change against the live template
alpaco push                  # propose it for review; prints the review link
alpaco status                # live version, and where your pending changes stand
alpaco withdraw <pendingId>  # take a pending change back
```

### What `pull` writes

```
alpaco.json                  template id and the version you pulled (commit this)
template.json                design settings; "blocks" lists the block folders in email order
base/config.json             the base's input groups
base/code.liquid             the base's Liquid
blocks/<key>/config.json     each block's name, key and input groups
blocks/<key>/code.liquid     each block's Liquid
vars/global.json             global variables
.alpaco/                     working state for this machine (git ignores it)
```

To reorder blocks, reorder `"blocks"` in `template.json`. To add a block, add a folder and list it there.

A pull followed by a push with no edits sends back exactly the JSON that was pulled.

### What `validate` checks

The API accepts any JSON, so the CLI applies the template designer's rules before a push:

- Block names and keys are filled in and unique.
- Input group and input names and keys are filled in and unique.
- `vars/global.json` is valid JSON.
- Every `code.liquid` parses as Liquid.

It also **warns** when a block, input group or input key has been removed or renamed since the pull. Emails store marketers' content under those keys, so it is lost the next time someone clicks **Update layout**. `push` asks before sending such a change, or needs `--yes`.

### When a push is refused

- **Template saved since you pulled.** Someone saved it in Alpaco after your pull. Keep a copy of your changes, run `alpaco pull [template ID] --force` from the template folder, re-apply them and push again.
- **Change outdated.** `alpaco status` shows a change as `outdated` when the template changed after you pushed it. Do the same: pull, re-apply, push.

There is no `publish` command or `--force` push. Publishing only happens in Alpaco.

## Develop

```sh
npm install
npm test
npm run build
node dist/cli.js --help
```

### Release

Releases are published to npm by GitHub Actions ([release.yml](.github/workflows/release.yml)) using npm trusted publishing, so no npm token is stored anywhere.

```sh
npm version minor          # or patch / major / prerelease --preid beta; commits and tags vX.Y.Z
git push --follow-tags
```

Then approve the run in the `npm-release` environment on GitHub. Pre-release versions (with a `-`) are published under the `next` tag.

## License

MIT
