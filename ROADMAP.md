# Roadmap

What DockScope is trying to become, and where the open work sits. This is
direction, not a schedule. Nothing here is assigned, and anything labelled
[help wanted][hw] is genuinely open.

If you want to pick something up, comment on the issue first so two people do
not build the same thing.

## The idea

Most Docker dashboards answer "what is running". DockScope tries to answer the
harder questions: **what depends on what**, **what changed**, and **why did that
break**. Everything below follows from that.

## Be useful while the tab is closed

Today DockScope only helps if you are looking at it. Anomalies pulse, crash
diagnostics appear, and if nobody is watching, none of it is recorded.

- [#37 Webhook alerts for anomalies and crashes][37] [help wanted][hw]
  The server already detects both in `monitor.ts`. This forwards them to a
  configurable endpoint with Slack and Discord formatting.
- [#36 Flight recorder][36] [help wanted][hw]
  A rolling buffer of the last 10 to 15 minutes, so you can save an incident
  *after* it happens rather than needing to have pressed REC beforehand. The
  recording tap it needs already exists.
- [#38 Persistent metric history][38]
  History currently lives in memory, capped at about 5 minutes. Persisting it
  gives 1h and 24h ranges, which is what finding a slow leak actually requires.

## Show more of what Docker already knows

Docker exposes a lot that no dashboard surfaces well.

- [#39 Cleanup panel][39] [good first issue][gfi]
  Dangling images, orphaned volumes, stopped containers, build cache, with
  sizes and prune actions.
- [#42 Config drift detection][42]
  Compare running containers against their compose file and badge the
  difference. "This container is not running what the file says" is a question
  people answer by hand today.
- [#40 Image update badges][40]
  A read-only, Watchtower-style check for newer digests.
- [#41 Merged project log stream][41] [help wanted][hw]
  `docker compose logs -f` for a whole project, in one pane, colour-coded.

## Make the view yours

The 3D force graph is one opinion about how to draw a stack. It should not be
the only one.

- [#23 Theme support][23] [good first issue][gfi]
  Light and cyberpunk alongside the current dark. The token layer in
  `App.css` is already there to build on.
- [#24 Layout modes][24]
  A 2D flat view and a tree view, for when hierarchy reads better than physics.
- [#25 Custom dashboards][25]
  Pin containers, save layouts, build focused views.

## Be safe to reach from somewhere other than your laptop

Access tokens and reverse proxy auth landed in v0.10, and a second read-only
token now supports wall displays and shared observational access without exec
or mutation permissions. Readers still see sensitive operational data, so an
exposed instance belongs on a trusted network behind a proxy you run.

- [#47 Serve HTTPS directly][47]
  The server is plain HTTP, so the token crosses your LAN in the clear unless
  something else terminates TLS.
- [#48 Audit log for container actions][48]
  Nothing records who exec'd into what. Exec is the highest-privilege thing
  DockScope offers and the least accountable.
- [#50 Document a hardened Docker socket proxy][50] [good first issue][gfi]
  "Only run it on trusted machines" is accurate advice that gives the reader
  nothing to do. A socket proxy is the thing to do.

## Make incidents shareable

Recording and replay landed in v0.7. The remaining piece is getting a clip out
of it.

- [#44 Replay to GIF export][44] [good first issue][gfi]
  Render a replay, or a range of one, to an animated GIF client-side.

## Beyond Docker

Kubernetes ships as an official plugin, and the plugin contract is the
extension point for everything else. If you want DockScope to speak to
something it does not yet, that is a plugin, not a core change. See
[Writing a plugin](docs/plugins.md).

## Recently shipped

| Version   | What landed                                                            |
| --------- | ---------------------------------------------------------------------- |
| **0.10**  | Access tokens, first-run setup, reverse proxy auth, Kubernetes workloads, pod exec and metrics |
| **0.9**   | Kubernetes moved onto the cluster API, no `kubectl` required            |
| **0.8**   | Signed plugin catalogs, marketplace, approval review                    |
| **0.7**   | Session recording and replay, PNG and SVG export, plugin system          |
| **0.6**   | Kubernetes resources, graph reconciliation                              |
| **0.5**   | Multiple Docker hosts on one graph                                      |
| **0.4**   | Anomaly detection, crash diagnostics, impact view                       |

## Proposing something else

Open a [feature request][fr]. The ideas most likely to land are the ones that
answer a debugging question you actually had, rather than adding a panel
because the data exists.

[gfi]: https://github.com/ManuelR-T/dockscope/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22
[hw]: https://github.com/ManuelR-T/dockscope/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22
[fr]: https://github.com/ManuelR-T/dockscope/issues/new?template=feature_request.yml
[23]: https://github.com/ManuelR-T/dockscope/issues/23
[24]: https://github.com/ManuelR-T/dockscope/issues/24
[25]: https://github.com/ManuelR-T/dockscope/issues/25
[36]: https://github.com/ManuelR-T/dockscope/issues/36
[37]: https://github.com/ManuelR-T/dockscope/issues/37
[38]: https://github.com/ManuelR-T/dockscope/issues/38
[39]: https://github.com/ManuelR-T/dockscope/issues/39
[40]: https://github.com/ManuelR-T/dockscope/issues/40
[41]: https://github.com/ManuelR-T/dockscope/issues/41
[42]: https://github.com/ManuelR-T/dockscope/issues/42
[44]: https://github.com/ManuelR-T/dockscope/issues/44
[47]: https://github.com/ManuelR-T/dockscope/issues/47
[48]: https://github.com/ManuelR-T/dockscope/issues/48
[50]: https://github.com/ManuelR-T/dockscope/issues/50
