# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository is newly initialized. As of this writing it contains only `README.md` ("USPTO Website Project") and a single initial commit — no source code, build tooling, dependency manifests, tests, or configuration yet.

There are therefore no build, lint, test, or run commands to document. The project's intent, per the README, is a USPTO website.

## Guidance for future instances

When the project gains structure, update this file with:
- Build / lint / test / run commands (including how to run a single test).
- The big-picture architecture that spans multiple files and isn't obvious from reading any one of them.

Until then, do not assume a framework, language, or toolchain — confirm with the user before scaffolding, and prefer establishing the stack explicitly over inferring it.

## Git Guidelines
- Every time you successfully complete a file modification or feature request, you must automatically run 'git add .', generate a concise commit message, run 'git commit', and immediately run 'git push origin main' to sync it online.

