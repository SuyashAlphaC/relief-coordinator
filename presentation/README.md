# Relief Desk presentation

A 15-slide, 16:9 Beamer draft matching the supplied QueryForge X deck's indigo title bars, white canvas, typography, diagram style, and page counters.

- `relief_desk_presentation.pdf`: compiled slides.
- `relief_desk_presentation.tex`: editable, self-contained source; diagrams are native TikZ.

## Build

From this directory, run twice to resolve page totals and hyperlinks:

```sh
pdflatex -interaction=nonstopmode -halt-on-error relief_desk_presentation.tex
pdflatex -interaction=nonstopmode -halt-on-error relief_desk_presentation.tex
```

Requires a LaTeX installation with Beamer, Latin Modern, microtype, booktabs, tabularx, TikZ, and listings. The source also works as an Overleaf main document using pdfLaTeX; no external images are required.

## Before submission

Edit the author, institute, and date fields near the beginning of the source to include the complete project team, roll numbers, and course details. Suyash Agrawal is used from the reference deck; no additional team identities have been assumed.

The evaluation slide records the existing 23 October 2026 verification (17 database/security tests and seven browser tests). It separates local test evidence from production observations and does not claim load-test results. Update the production Cron verification note if a later signed-in check confirms a successful scheduled run.

## Slide sequence

1. Title
2. Problem statement
3. Existing approaches and project gap
4. Cloud service mapping
5. System architecture
6. Incident submission sequence
7. User workflow and roles
8. Inventory consistency
9. Private incident attachments
10. Queues and scheduled alerts
11. Live collaboration and recovery
12. Evaluation
13. Engineering challenges
14. Limitations and future work
15. Takeaway, live application link, and references
