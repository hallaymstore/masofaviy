# VM 559 compliance implementation

This repository implements software controls aligned to the current text of Uzbekistan Cabinet of Ministers Resolution No. 559 of 3 October 2022 (LexUZ: https://lex.uz/docs/-6221502).

## Important boundary

This repository cannot by itself certify legal compliance. Resolution 559 includes institutional and physical requirements that must be satisfied by Qarshi davlat texnika universiteti outside the codebase, including:

- a server physically located in Uzbekistan and owned by the university or held under a lease agreement with a term of at least 5 years;
- high-speed Internet and ICT infrastructure;
- equipped computer rooms meeting applicable sanitary requirements;
- qualified technical staff;
- complete annual learning content and electronic teaching-methodical complexes for all subjects;
- evidence that electronic resources meet O‘zDSt 36.2030;
- official-system integration credentials and acceptance from the competent system owner;
- in-person LMS registration for students before the study process;
- in-person semester final assessment, state attestation, bachelor qualification work and master thesis defense where required by the Resolution.

The /api/vm559/overview endpoint and **559 Talablar** UI distinguish software-ready requirements from items that need institutional evidence.

## Implemented software controls

### 1. LMS functional components
The platform contains or tracks:

- information resources and course materials;
- users, roles, access control and authentication;
- action audit logs;
- attendance and academic performance;
- individual study plans and credit records;
- chat, messages, live lessons and videoconferencing;
- student and teacher registry;
- course/fan management;
- schedule, deadlines and teaching management;
- statistics and student movement history;
- assignments, tests, examination results and proctoring events.

### 2. 1:50 teacher/student limit
New lesson creation/update is rejected when a group contains more than 50 active students. The API returns teacher_student_ratio_exceeded.

For real groups larger than 50, the institution should split the teaching flow into compliant subgroups or otherwise assign teaching in a manner approved by the institution and consistent with the regulation.

### 3. SCORM
scorm-runtime.js provides:

- SCORM ZIP import with imsmanifest.xml validation;
- SCORM 1.2 and 2004 launch support;
- same-origin authenticated package delivery;
- SCORM runtime data persistence per student/package;
- completion/status/score persistence;
- progress listing.

SCORM package files must be stored on persistent production storage via SCORM_STORAGE_DIR.

### 4. Academic registry
vm559-runtime.js provides:

- distance-program registry;
- bachelor's/master's quota controls (300/30 unless the ICT exception applies);
- daytime-program requirement checks;
- student movement history;
- individual study plans;
- credit records;
- practice/internship records;
- onsite registration verification.

### 5. Final assessment policy
The API blocks creating remote exams with these assessment types:

- semester_final
- state_attestation
- bachelor_defense
- master_defense
- final

These events must be handled as onsite processes according to the current Resolution text for domestic students.

### 6. Quality monitoring and complaints
The platform includes:

- lesson/assessment observation records;
- surveys;
- focus-group/interview/result-evaluation records;
- corrective-action notes;
- complaints/appeals and status tracking.

### 7. Ministry / HEMIS adapter
The platform provides:

- status endpoint;
- JSON export;
- configurable outbound sync endpoint.

A live state-system connection is not claimed unless HEMIS_API_URL and HEMIS_API_TOKEN are supplied by the authorized system owner and the integration is accepted.

### 8. Audit/security
The runtime adds:

- mutating-request audit logs;
- login attempt throttling;
- configurable audit retention;
- configurable proctor-event retention.

Existing platform controls include role-based authorization, secure session cookies in production, password hashing, Helmet and group-level access rules.

## Production environment checklist

Set these values only to truthful values:

```env
SERVER_COUNTRY=UZ
SERVER_OWNERSHIP=owned
SERVER_LEASE_YEARS=5
DEPLOYMENT_MODE=production
SCORM_STORAGE_DIR=/absolute/persistent/path/scorm
AUDIT_RETENTION_DAYS=730
PROCTOR_RETENTION_DAYS=180
HEMIS_API_URL=
HEMIS_API_TOKEN=
HEMIS_SYNC_PATH=/lms/sync
PROCTOR_AI_ENDPOINT=
```

If the server is leased, set SERVER_OWNERSHIP=lease and SERVER_LEASE_YEARS to the actual contract term.

## Evidence that must be uploaded/recorded

Use the **559 Talablar** page to record real evidence for:

- Internet/ICT infrastructure;
- equipped rooms and sanitary compliance;
- qualified engineering/technical staff;
- Uzbekistan server ownership or 5-year lease;
- official university website information;
- O‘zDSt 36.2030 conformity;
- official information-system integration.

Do not mark evidence as verified unless it has actually been checked by an authorized university officer.

## Self-check

Managers can call:

```
GET /api/vm559/selfcheck
```

The response lists unresolved software/configuration/evidence items. A clean software self-check still does not replace institutional legal review or certification.
