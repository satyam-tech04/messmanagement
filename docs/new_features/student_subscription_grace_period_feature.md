# Feature Specification: Student Subscription Grace Period

## 1. Feature Overview

Add an **Administrator-only Grace Period** feature to the existing Mass Management System.

The system has three user roles:

- Administrator
- Staff
- Student

This feature applies to the **Administrator portal** and affects the student's subscription and meal-scanner availability.

A Grace Period allows an administrator to temporarily pause a student's subscription. During the pause:

- The student can continue logging into the application normally.
- The student's meal scanner must not be displayed or available.
- The student must not be able to obtain/scan any meals.
- The subscription validity is extended by the number of days for which the subscription was actually paused.
- The subscription automatically resumes on the configured Resume Date.

The feature must support both **currently active subscriptions** and **upcoming subscriptions**.

---

## 2. Goals

The implementation must allow an administrator to:

1. Create a grace period for an eligible student subscription.
2. Configure the grace-period start and resume dates.
3. Enter administrator remarks.
4. See the calculated number of grace days before confirming.
5. Enter the subscription end date that should be used after the grace period.
6. Modify an existing grace period instead of creating overlapping grace periods.
7. Extend an existing grace period.
8. Cancel a scheduled grace period before it starts.
9. Resume an active grace period early.
10. Ensure the student cannot access meal-scanning functionality during an active grace period.
11. Display the grace-period status and dates to the student while applicable.

---

## 3. Subscription Eligibility

Grace Period functionality must be available for:

- **Active subscriptions**
- **Upcoming subscriptions**

Grace Period functionality must **not** be available for:

- Cancelled subscriptions

The implementation should also prevent a Grace Period from being configured outside the applicable subscription period.

### Subscription-period rule

A Grace Period must not start before the subscription start date.

For example:

- Subscription: 10 Sep – 10 Oct
- Grace Period: 15 Sep – 20 Sep → Valid
- Grace Period: 5 Sep – 12 Sep → Invalid

For an upcoming subscription, the Grace Period may be configured in advance, but it must still fall within the subscription period.

---

# 4. Grace Period Data

Each Grace Period should contain at least the following information:

| Field                 | Required                                            | Description                                                                                |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Start Date            | Yes                                                 | First date on which the subscription is paused                                             |
| Resume Date           | Yes                                                 | First date on which the subscription becomes active again                                  |
| Grace Days            | System calculated                                   | Number of days between Start Date and Resume Date during which the subscription is paused  |
| Subscription End Date | Yes                                                 | End date entered by the administrator for the subscription after applying the grace period |
| Remarks               | Yes/No according to existing application convention | Administrator's notes/reason for the grace period                                          |
| Status                | System managed                                      | Scheduled, Active, Completed/Ended, or Cancelled as applicable                             |

Do not introduce a separate remarks/history mechanism. The existing remarks field can be edited by the administrator when modifying the Grace Period.

---

# 5. Date and Time Rules

## 5.1 Grace Period Start Date

The Start Date:

- Must not be in the past.
- Must not be today.
- Must therefore be **tomorrow or a future date** when a new Grace Period is created.
- Must not be before the subscription start date.
- Must fall within the subscription period.

Example:

If today is 29 Aug:

- 28 Aug → Invalid
- 29 Aug → Invalid
- 30 Aug → Valid, assuming it falls within the subscription period

## 5.2 Resume Date

The Resume Date:

- Must be after the Start Date.
- Cannot be the same date as the Start Date.
- Must not be before the Start Date.
- Must fall within/appropriately extend the subscription lifecycle according to the application's subscription-date model.

The recommended interpretation is:

- **Start Date = first paused day**
- **Resume Date = first active day**

Therefore, the Resume Date itself is **not** a paused day.

Example:

- Start Date: 30 Aug
- Resume Date: 5 Sep

Paused dates:

- 30 Aug
- 31 Aug
- 1 Sep
- 2 Sep
- 3 Sep
- 4 Sep

Grace Days = **6**

The subscription resumes on **5 Sep**.

## 5.3 Grace Day Calculation

Calculate Grace Days as the date difference:

`Resume Date - Start Date`

Do not count the Resume Date as a grace day.

The calculated Grace Days must be displayed to the administrator before confirmation.

---

# 6. Administrator Workflow

## 6.1 Creating a Grace Period

Recommended navigation:

**Administrator → Student → Existing Subscription/Plan → Modify Plan → Grace Period**

The administrator should be able to select/configure:

1. Grace Period Start Date
2. Grace Period Resume Date
3. Remarks
4. Subscription End Date

The system should automatically calculate and display:

**Grace Days**

before the administrator confirms the operation.

### Example

```text
Grace Period Start Date:   30 Aug 2026
Grace Period Resume Date:  05 Sep 2026
Grace Days:                6 days
Subscription End Date:     10 Oct 2026
Remarks:                   Student leave
```

The administrator then confirms the configuration.

---

# 7. Subscription End Date

The administrator will enter the final Subscription End Date manually.

The system must **not automatically overwrite the administrator-entered Subscription End Date**.

The confirmation/configuration screen should therefore display:

- Grace Period Start Date
- Grace Period Resume Date
- Calculated Grace Days
- Subscription End Date **as entered by the administrator**
- Remarks

The implementation may validate the entered end date against the grace-period calculation where appropriate, but it must not silently replace the administrator's entered value.

The coding agent should preserve the existing application's subscription-date conventions and avoid introducing a second conflicting end-date calculation model.

---

# 8. Subscription Extension Behavior

The purpose of the Grace Period is to preserve the student's subscription entitlement.

The subscription is effectively paused during the Grace Period, so the paused subscription days are pushed forward.

Example:

```text
Original Subscription:
Start Date = 01 Sep
End Date   = 30 Sep

Grace Period:
Start Date = 10 Sep
Resume Date = 16 Sep

Paused Days = 6

Result:
The subscription receives 6 additional subscription days.
```

The student does not lose the subscription days that fall during the Grace Period.

---

# 9. Upcoming Subscription Behavior

Upcoming subscriptions can have a Grace Period configured before the subscription begins.

However:

- The Grace Period must not start before the subscription start date.
- A Grace Period cannot create a pause outside the subscription period.
- The subscription should behave normally until the Grace Period's Start Date is reached.

Example:

```text
Subscription:
10 Sep – 10 Oct

Grace Period:
15 Sep – 20 Sep

Behavior:
10–14 Sep  → Normal subscription
15–19 Sep  → Grace Period
20 Sep      → Subscription resumes
```

---

# 10. Student Access During Grace Period

The student's normal application login must remain available.

The Grace Period must **not disable the student's account/login**.

However, while the Grace Period is active:

### Meal Scanner

The Meal Scanner must:

- Not be displayed on the student login/application.
- Not be available for generation.
- Not allow the student to obtain a meal.
- Not allow the student to scan a meal.

The Grace Period restriction must take precedence over normal meal-scanner eligibility.

The implementation must enforce this at the business/backend level as well as the UI level where applicable. Simply hiding the scanner in the UI is not sufficient if an existing API/action could still generate or process a meal scanner.

---

# 11. Meal Behavior

The student must not receive or consume any meals during an active Grace Period.

Because a scanner is generated for each meal, there is no requirement to preserve or reuse an existing scanner.

When the Grace Period becomes active:

- The student should not see the meal scanner.
- The student should not be able to generate a scanner.
- The student should not be able to scan/claim a meal.

When the Grace Period ends, normal meal-scanner functionality should automatically become available again according to the existing subscription/meal rules.

---

# 12. Student Grace Period Display

If technically possible within the existing student login UI, display the Grace Period status to the student.

Recommended display:

```text
Grace Period Active

Start Date: 30 Aug 2026
Resume Date: 05 Sep 2026

Your subscription will resume on 05 Sep 2026.
```

The display should make it clear that:

- The subscription is currently paused.
- The student cannot use the meal scanner during this period.
- The Resume Date is the first date on which normal subscription functionality resumes.

This is a UI/status display, not a push/email notification system.

No new notification infrastructure is required for this feature.

---

# 13. Grace Period Status

The implementation should maintain a clear state for the Grace Period.

Recommended statuses:

### Scheduled

The Grace Period has been configured but its Start Date has not yet been reached.

Behavior:

- Subscription remains normal.
- Student can use the meal scanner normally.
- Administrator can modify or cancel the Grace Period.

### Active

The current date is on/after the Start Date and before the Resume Date.

Behavior:

- Subscription is paused.
- Student can log in.
- Meal scanner is unavailable.
- Student cannot obtain/scan meals.
- Administrator can modify, extend, or resume early.

### Completed / Ended

The Resume Date has been reached.

Behavior:

- Subscription resumes normally.
- Meal scanner becomes available according to normal subscription rules.
- Grace-period information can remain associated with the subscription as historical/current data according to the application's existing data model.

### Cancelled

A scheduled Grace Period was cancelled before it started.

Behavior:

- No subscription pause occurs.
- No subscription extension is applied because of that Grace Period.
- Student continues using the subscription normally.

---

# 14. Modify Existing Grace Period

A student must not have overlapping Grace Period records for the same subscription.

If a Grace Period already exists, the administrator must be able to **modify the existing Grace Period** rather than creating another overlapping Grace Period.

The administrator can modify:

- Start Date
- Resume Date
- Subscription End Date
- Remarks

Subject to the same applicable validation rules.

The system must recalculate the Grace Days whenever the dates change.

---

# 15. Extending an Existing Grace Period

The administrator can extend an existing Grace Period.

Example:

```text
Existing:
Start Date  = 20 Sep
Resume Date = 25 Sep

Administrator changes:
Resume Date = 30 Sep
```

The system should recalculate the Grace Days based on the new dates and update the subscription accordingly.

The student remains unable to use the meal scanner until the new Resume Date.

---

# 16. Resume Early

The administrator must be able to manually end an **active** Grace Period before its originally configured Resume Date.

Example:

```text
Grace Period:
20 Sep – 30 Sep

Administrator resumes early:
25 Sep
```

The subscription should resume on the administrator-selected/current resume date.

Only the days for which the subscription was actually paused should contribute to the subscription extension.

Unused future Grace Period days must not continue to extend the subscription.

This action should be treated as an **early resume**, not as creating a new Grace Period.

---

# 17. Cancel Grace Period

The administrator must be able to cancel a **scheduled Grace Period** before it starts.

When a scheduled Grace Period is cancelled:

- The Grace Period is removed/cancelled.
- The subscription remains unchanged.
- No subscription extension is applied because of the cancelled Grace Period.
- The student continues to use the subscription normally.
- The meal scanner remains available according to normal subscription rules.

Cancellation of an already active Grace Period should instead use the **Resume Early** action.

---

# 18. Administrator Permissions

Only an authenticated **Administrator** should be able to:

- Create a Grace Period.
- Modify a Grace Period.
- Extend a Grace Period.
- Cancel a scheduled Grace Period.
- Resume an active Grace Period early.
- Change the administrator-entered subscription end date associated with the Grace Period.

Staff and Student users must not be given these controls.

---

# 19. Validation Rules

At minimum, implement the following validations.

### Subscription validation

- Subscription must not be cancelled.
- Subscription must be an eligible active or upcoming subscription.
- Grace Period must not start before the subscription start date.
- Grace Period must fall within the applicable subscription lifecycle.

### Start Date validation

- Required.
- Cannot be in the past.
- Cannot be today for a newly created Grace Period.
- Must be tomorrow or later.
- Cannot be before subscription start date.

### Resume Date validation

- Required.
- Must be after Start Date.
- Cannot equal Start Date.
- Must satisfy the subscription lifecycle/date rules.

### Existing Grace Period validation

- Do not create overlapping Grace Periods for the same subscription.
- Modify the existing Grace Period instead.

### Meal scanner validation

While a Grace Period is active:

- Scanner generation must be rejected/disabled.
- Meal scanning must be rejected/disabled.
- Meal entitlement/claiming through the scanner must not be possible.

These restrictions should not rely solely on front-end visibility.

---

# 20. Confirmation Before Saving

Before the administrator confirms a new or modified Grace Period, display the relevant calculated information.

Recommended confirmation:

```text
Grace Period

Start Date:       30 Aug 2026
Resume Date:      05 Sep 2026
Grace Days:       6 days
Subscription End Date: 10 Oct 2026
Remarks:          Student leave

[Confirm] [Cancel]
```

The Grace Days value is system calculated.

The Subscription End Date displayed must be the date entered by the administrator.

The administrator should be able to review the information before committing the change.

---

# 21. Business Logic for Date Calculations

Use the following interpretation consistently:

```text
Paused period = [Start Date, Resume Date)

Grace Days = Resume Date - Start Date
```

Meaning:

- Start Date is included.
- Resume Date is excluded from the pause.
- The subscription is active again on Resume Date.

Example:

```text
Start Date  = 01 Oct
Resume Date = 04 Oct

Paused:
01 Oct
02 Oct
03 Oct

Grace Days = 3
Resume = 04 Oct
```

---

# 22. Important Modification/Recalculation Rule

When modifying a Grace Period, the implementation must avoid accidentally accumulating extensions from previous configurations.

The current Grace Period configuration should be treated as the source of truth for the current pause.

Do not repeatedly add the full new Grace Period duration on top of an already extended subscription end date merely because the administrator edited the Grace Period multiple times.

The system should recalculate the resulting subscription dates consistently from the current subscription/grace-period state.

For an early resume, calculate the extension from the **actual paused duration**, not the originally scheduled duration.

---

# 23. UI Requirements

The Administrator UI should provide a clear way to access Grace Period functionality from an eligible student's subscription.

Recommended structure:

```text
Student
  └── Subscription
       └── Modify Plan
            └── Grace Period
```

The Grace Period interface should expose:

- Current Grace Period status, if one exists
- Start Date
- Resume Date
- Automatically calculated Grace Days
- Subscription End Date
- Remarks
- Appropriate action buttons based on status

### Actions by status

| Status          | Available actions                            |
| --------------- | -------------------------------------------- |
| No Grace Period | Add Grace Period                             |
| Scheduled       | Modify, Extend, Cancel                       |
| Active          | Modify, Extend, Resume Early                 |
| Completed       | View status/details according to existing UI |
| Cancelled       | Add a new Grace Period if otherwise eligible |

---

# 24. Student UI Requirements

When a Grace Period is active:

- Student login must continue working.
- Meal Scanner must not be displayed.
- Student should see Grace Period information if the existing UI supports adding this status.
- Display Start Date and Resume Date.
- Make the unavailable meal functionality understandable to the student.

When the Grace Period ends:

- Grace Period active indication should no longer be shown.
- Meal Scanner should become available again according to normal business rules.

---

# 25. No Audit Trail Requirement

There is currently no audit functionality in the application.

Do **not** introduce a separate audit-trail system as part of this feature.

Do not make audit logging a dependency for completing the Grace Period feature.

---

# 26. No Notification System Requirement

There is currently no notification system.

Do **not** implement email, SMS, push notifications, or a new notification infrastructure for this feature.

The requested student-facing Grace Period information is a UI/status display only.

---

# 27. Edge Cases

The implementation should correctly handle at least these cases:

### Case 1 — Start date is today

Reject.

### Case 2 — Start date is in the past

Reject.

### Case 3 — Start date is before subscription start

Reject.

### Case 4 — Resume date equals Start Date

Reject.

### Case 5 — Resume date is before Start Date

Reject.

### Case 6 — Cancelled subscription

Grace Period cannot be created.

### Case 7 — Upcoming subscription

Grace Period can be configured as long as it is within the subscription period and satisfies all date rules.

### Case 8 — Existing Grace Period

Modify the existing Grace Period rather than creating an overlapping one.

### Case 9 — Scheduled Grace Period cancelled

No subscription change.

### Case 10 — Active Grace Period resumed early

Subscription resumes immediately according to the application's date/time rules, and only actual paused days contribute to the extension.

### Case 11 — Active Grace Period extended

Update the Resume Date and recalculate the Grace Days and resulting subscription validity.

### Case 12 — Student attempts to use meal functionality during Grace Period

The operation must be blocked even if the request attempts to bypass the hidden UI.

### Case 13 — Grace Period ends

Normal subscription and meal-scanner functionality resumes automatically.

---

# 28. Acceptance Criteria

## AC1 — Create Grace Period

**Given** an eligible active or upcoming subscription  
**When** an administrator enters valid Start Date, Resume Date, Remarks, and Subscription End Date  
**Then** the system should calculate and display the Grace Days before confirmation.

## AC2 — Start Date Validation

**Given** today's date is the current system date  
**When** the administrator enters today's date or a past date as the Grace Period Start Date  
**Then** the system must reject the value.

## AC3 — Subscription Start Validation

**Given** a subscription has a defined start date  
**When** the administrator selects a Grace Period Start Date before the subscription start date  
**Then** the system must reject the Grace Period.

## AC4 — Resume Date Validation

**Given** a Grace Period Start Date  
**When** the administrator enters a Resume Date that is the same as or earlier than the Start Date  
**Then** the system must reject the configuration.

## AC5 — Grace Day Calculation

**Given** Start Date = 30 Aug and Resume Date = 5 Sep  
**When** the dates are entered  
**Then** the system must display **6 Grace Days**.

## AC6 — Student Login

**Given** a student has an active Grace Period  
**When** the student logs in  
**Then** the student must be able to log in normally.

## AC7 — Meal Scanner Disabled

**Given** a student is within an active Grace Period  
**When** the student accesses the application  
**Then** the Meal Scanner must not be displayed or available.

## AC8 — Meal Access Blocked

**Given** a student is within an active Grace Period  
**When** the student attempts to generate/use a meal scanner or obtain a meal  
**Then** the operation must be blocked.

## AC9 — Automatic Resume

**Given** a Grace Period is active  
**When** the Resume Date is reached  
**Then** the subscription should become active again and normal meal-scanner functionality should resume according to the existing subscription rules.

## AC10 — Student Grace Period Display

**Given** a Grace Period is active  
**When** the student logs in  
**Then** the system should display the Grace Period status and its Start Date and Resume Date where the existing UI supports this feature.

## AC11 — Modify Existing Grace Period

**Given** a student already has a Grace Period  
**When** an administrator modifies its dates  
**Then** the existing Grace Period must be updated rather than creating an overlapping Grace Period.

## AC12 — Extend Grace Period

**Given** an active Grace Period  
**When** an administrator extends the Resume Date  
**Then** the system must recalculate the Grace Days and keep the student's meal-scanner functionality unavailable until the new Resume Date.

## AC13 — Cancel Scheduled Grace Period

**Given** a Grace Period is scheduled but has not started  
**When** an administrator cancels it  
**Then** the Grace Period must be cancelled and the subscription must remain unchanged.

## AC14 — Resume Early

**Given** an active Grace Period  
**When** an administrator resumes it early  
**Then** the Grace Period must end early and only the actual paused duration must affect the subscription extension.

## AC15 — No Cancelled Subscription

**Given** a cancelled subscription  
**When** an administrator attempts to configure a Grace Period  
**Then** the system must prevent the operation.

## AC16 — No Overlapping Grace Periods

**Given** a subscription already has a Grace Period  
**When** an administrator attempts to add another Grace Period  
**Then** the system must direct the administrator to modify the existing Grace Period rather than create an overlapping period.

---

# 29. Implementation Guidance for the Coding Agent

Before implementing this feature:

1. Inspect the existing subscription/plan data model.
2. Identify how active, upcoming, expired, and cancelled subscriptions are currently represented.
3. Identify how subscription start/end dates are stored and calculated.
4. Identify the existing meal-scanner generation flow.
5. Identify the backend/API/service responsible for validating and issuing meal scanners.
6. Identify the student login/dashboard UI where subscription information is displayed.
7. Identify the administrator UI for modifying a student's subscription.
8. Reuse existing date/time utilities, validation mechanisms, authentication, authorization, and UI components wherever possible.
9. Do not create duplicate subscription systems or parallel meal-eligibility logic.
10. Enforce the Grace Period at the authoritative business-logic/backend layer, not only in the student UI.
11. Preserve existing application behavior outside the Grace Period.
12. Do not introduce an audit system or notification infrastructure.
13. Ensure database/API changes are backward compatible with existing subscriptions that have no Grace Period.
14. Ensure existing students without a Grace Period continue to work exactly as before.
15. Add appropriate tests for date validation, Grace Period state transitions, subscription extension, modification, early resume, cancellation, and meal-scanner blocking.

---

# 30. Definition of Done

The feature is complete when:

- Administrators can create Grace Periods for active and upcoming subscriptions.
- Cancelled subscriptions are excluded.
- All date rules and validations are enforced.
- Grace Days are calculated automatically and shown before confirmation.
- The administrator's entered Subscription End Date is displayed and respected.
- Existing Grace Periods can be modified/extended without creating overlaps.
- Scheduled Grace Periods can be cancelled without changing the subscription.
- Active Grace Periods can be resumed early.
- Subscription extension reflects the actual paused duration.
- Students can still log in during a Grace Period.
- Students cannot see, generate, use, or bypass the meal scanner during an active Grace Period.
- Students cannot obtain meals during an active Grace Period.
- Normal meal-scanner functionality resumes when the Grace Period ends.
- Student-facing Grace Period dates/status are displayed where technically supported by the existing UI.
- No audit-trail or notification infrastructure is introduced.
- Existing subscriptions without Grace Periods remain unaffected.
- Appropriate automated/manual tests pass.
