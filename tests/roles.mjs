// Run only against the local built Worker: it simulates the trusted hosting proxy.
import assert from "node:assert/strict";
const base = "http://127.0.0.1:8793";
const user = (id) => ({
  "oai-authenticated-user-id": id,
  "oai-authenticated-user-email": `${id}@test.example`,
});
const get = async (id) => {
  const r = await fetch(`${base}/api/state`, { headers: user(id) });
  assert.equal(r.status, 200);
  return r.json();
};
const post = async (id, data) =>
  fetch(`${base}/api/action`, {
    method: "POST",
    headers: { ...user(id), "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(data),
  });
const state = await get("role-test-reporter");
const admin = state.members.find((m) => m.role === "coordinator");
assert(admin, "Initialize the local workspace with a coordinator first.");
const team = {
  action: "team",
  name: "Role test team",
  specialty: "Medical",
  personnel: 4,
  location: "Local test",
};
assert.equal((await post("role-test-reporter", team)).status, 403);
assert.equal(
  (
    await post("role-test-reporter", {
      action: "role",
      id: "role-test-reporter",
      role: "coordinator",
    })
  ).status,
  403,
);
assert.equal(
  (
    await post(admin.id, {
      action: "role",
      id: "role-test-reporter",
      role: "responder",
    })
  ).status,
  200,
);
assert.equal((await post("role-test-reporter", team)).status, 403);
assert.equal(
  (
    await post("role-test-reporter", {
      action: "resource",
      name: "Test resource",
      unit: "kits",
      quantity: 5,
      location: "Depot",
    })
  ).status,
  403,
);
const incident = await post("role-test-reporter", {
  action: "incident",
  data: {
    title: "Role test incident",
    type: "Other",
    severity: "low",
    location: "Test location",
    description: "A local test report for authorization checks.",
    people: 0,
    lat: null,
    lng: null,
  },
});
assert.equal(incident.status, 200);
const { id } = await incident.json();
const createdTeam = await post(admin.id, team);
assert.equal(createdTeam.status, 200);
const teamId = (await createdTeam.json()).id;
assert.equal(
  (
    await post("role-test-reporter", {
      action: "status",
      id,
      version: 1,
      status: "responding",
      teamId,
    })
  ).status,
  200,
);
assert.equal(
  (await post(admin.id, { action: "role", id: admin.id, role: "reporter" }))
    .status,
  400,
);
assert.equal(
  (
    await post(admin.id, {
      action: "role",
      id: "role-test-reporter",
      role: "reporter",
    })
  ).status,
  200,
);
assert.equal(
  (
    await post("role-test-reporter", {
      action: "status",
      id,
      version: 2,
      status: "resolved",
      teamId,
    })
  ).status,
  403,
);
console.log(
  "Role integration checks passed: reporter denial, escalation denial, responder limits, authorized assignment, self-demotion guard, and revocation.",
);
