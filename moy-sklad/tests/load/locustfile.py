"""Load test for the «Мой склад» test stand (morning peak: receiving, stock checks, requests, shipping).

Run only through `node orchestrator/run.js --stages load`, which checks the target against
orchestrator/scope.json first. This file re-checks the host as a second line of defence.
"""
import json
import os
from pathlib import Path

from locust import HttpUser, between, events, task

SCOPE = json.loads((Path(__file__).resolve().parents[2] / "orchestrator" / "scope.json").read_text(encoding="utf-8"))
ALLOWED = {t.rstrip("/") for t in SCOPE["allowedTargets"]}
PASSWORD = os.environ.get("MS_TEST_PASSWORD", "test-only-Passw0rd")
MAX_FAIL_RATIO = float(os.environ.get("MS_MAX_FAIL_RATIO", "0.01"))
MAX_P95_MS = float(os.environ.get("MS_MAX_P95_MS", "500"))


@events.test_start.add_listener
def refuse_out_of_scope(environment, **_kwargs):
    host = (environment.host or "").rstrip("/")
    if host not in ALLOWED:
        environment.process_exit_code = 2
        environment.runner.quit()
        raise SystemExit(f"[locust] host {host!r} is outside orchestrator/scope.json")


@events.quitting.add_listener
def enforce_thresholds(environment, **_kwargs):
    total = environment.stats.total
    p95 = total.get_response_time_percentile(0.95) or 0
    if total.fail_ratio > MAX_FAIL_RATIO:
        environment.process_exit_code = 1
        print(f"[locust] FAIL: error ratio {total.fail_ratio:.2%} > {MAX_FAIL_RATIO:.2%}")
    elif p95 > MAX_P95_MS:
        environment.process_exit_code = 1
        print(f"[locust] FAIL: p95 {p95:.0f} ms > {MAX_P95_MS:.0f} ms")


class WarehouseUser(HttpUser):
    abstract = True
    wait_time = between(1, 3)
    login = ""

    def on_start(self):
        res = self.client.post("/auth/login", json={"login": self.login, "password": PASSWORD}, name="/auth/login")
        token = res.json().get("token", "") if res.ok else ""
        self.client.headers.update({"Authorization": f"Bearer {token}"})

    @task(5)
    def stock(self):
        self.client.get("/api/batches", name="/api/batches")


class Storekeeper(WarehouseUser):
    weight = 3
    login = "test-staff"

    @task(2)
    def receive(self):
        self.client.post("/api/batches", json={"prod": "Укроп", "wh": "w1", "qty": 5}, name="/api/batches [receive]")

    @task(2)
    def ship(self):
        res = self.client.post("/api/requests", json={"lines": [{"prod": "Укроп", "qty": 1}]}, name="/api/requests")
        if res.ok:
            self.client.post(f"/api/requests/{res.json()['id']}/ship", name="/api/requests/:id/ship")


class Manager(WarehouseUser):
    weight = 1
    login = "test-manager"

    @task(3)
    def order(self):
        self.client.post("/api/requests", json={"lines": [{"prod": "Кинза", "qty": 2}]}, name="/api/requests")
