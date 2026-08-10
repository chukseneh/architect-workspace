# backend/src/config

Env-driven configuration loading (12-Factor: config separated from code).

## Belongs here

- Env var readers/getters (e.g., LLM API key loading)
- Timeout and retry constants

## Never goes here

- Hardcoded secrets, hostnames, or environment-specific literals
- Business logic

Currently empty — populated when the Week 3 component needs its first env-loaded value.
