---
name: Delegated identity safety
description: Authorization and locking constraints for future identity-management work.
---

Treat password resets and identity/email changes as indirect permission grants.
A non-Owner must not manage a target whose effective company permissions exceed
their own, even if the operator holds a user-reset or user-update permission.
Keep the existing restrictions on global Owners and cross-company identities.

**Why:** Restricting direct role assignment alone did not stop a limited reset
operator from taking over a stronger company-only administrator's account.

**How to apply:** Consider impersonation whenever adding an identity-management
action, not just when assigning roles. A successful administrative reset must
also revoke sessions and force a password change.

Obtain the global last-Owner guard before locking an identity row.

**Why:** The database's last-Owner trigger obtains that guard too. Inconsistent
row/guard acquisition order can deadlock otherwise unrelated identity writers.

**How to apply:** Keep login, password change, profile, administrator identity
edits and membership changes consistent when extending these flows. Lock mutable
records before reading audit before-images; a transaction alone does not ensure
the snapshot describes the immediately preceding committed version.
