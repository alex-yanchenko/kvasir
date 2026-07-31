# Kvasir privacy policy

_Last updated: 2026-07-30_

The Kvasir browser extension does not collect, transmit, or sell any personal
data. Everything it does runs on your own computer.

## What Kvasir does with data

- **It talks only to your own machine.** The extension's single network
  destination is a local program — the Kvasir _channel_ — reachable at
  `http://localhost:8799`, running on the same computer as your browser. It never
  contacts Kvasir's author, a Kvasir server (there isn't one), or any third party.
- **GitHub page content and your selections stay on-device.** To render a
  walkthrough and answer questions, the extension reads the diff or file you are
  viewing on GitHub and any code you select to ask about, and sends that to the
  local channel — where your own Claude Code session answers. This data is not sent
  off your device, not sold, and not used for anything beyond producing the
  walkthrough and answers you asked for.
- **Local browser storage only.** The extension stores your walkthrough progress,
  your one-time pairing approval for the local channel, and your settings in your
  browser's local storage. This never leaves your device.

## What Kvasir does not do

- No accounts, no API keys, no telemetry, no analytics.
- No data sold or transferred to third parties.
- No use of your data for advertising, profiling, or creditworthiness.

## Open source

Kvasir is open source. You can read exactly what it does, including every network
call, at <https://github.com/alex-yanchenko/kvasir>.

## Contact

Questions about this policy: open an issue at
<https://github.com/alex-yanchenko/kvasir/issues>.
