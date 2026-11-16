# Reply to Spenser: what changed after your review

Spenser, thank you for going through the demo so carefully. Below are your ten points in your order: what the product does now, what you would see and do, and what still needs something we cannot build on our own (a proper server, a paid journey-time service, an official data file, or a council to work with).

Everything in the demo is still invented: the households, properties, suppliers, staff and history. Nothing real goes into it until a council pilot.

## 1. Form checks: no blank case references, negative ages or incomplete household details

**Now:** press "Find placements" with anything missing or impossible and no search runs. A box at the top lists every problem, each one a link that takes you to the field, and each field says what is wrong. As you correct things, the list shrinks. It covers a blank or over-long case reference, nobody aged 16 or over, impossible ages (a "child" of 19, an "adult" of 12), partners who do not match, a date needed in the past, a stay of zero nights, places without a person or an arrive-by time, negative amounts the household can pay, and unanswered access questions. Some things are warnings rather than stops: a school set against an adult, or a case reference that already has an open search or a placement (with a link to it).

The same checks run however the household gets in, including from a file from the case system (point 10).

**Still needs:** nothing.

## 2. Disability needs trigger the checks

**Now:** tick "Wheelchair user" against a person (or the household's disability flag) and an access panel opens for that person with six yes/no questions: wheelchair-accessible home, step-free access, ground floor or a lift, adapted bathroom, an assistance dog, and equipment or a carer that could change the bedroom need. Nothing is pre-answered, and the search will not run until every question is answered. Every "yes" becomes a check each property must pass, and a property that fails says whose need it fails ("Adult 1 needs step-free access: this property does not have it"). The record shows the answers and the officer who confirmed them.

**Still needs:** a solicitor to confirm the six questions, and a rule for when equipment or a carer should change the number of bedrooms (today it gives a warning to check by hand).

## 3. Prevent double bookings

**Now:** once a property is held, booked or occupied for a case, every other search for overlapping dates rules it out, with the dates ("Held for another case until 14:00 on 17 Nov", "Booked 3 Nov to 2 May") and nothing about the other household. When you record a decision, it checks again at that moment, in case someone took the property after your search; if so it tells you and offers a fresh search. The properties list shows who holds each unit, by case reference, and until when.

**Still needs:** a proper server. The demo keeps everything in each person's own browser, so two officers on two computers are not yet protected from each other. That protection comes with the hosted pilot.

## 4. No pre-ticked consent

**Now:** for a family with children, you record whether a parent consented to the school, GP and health visitor being told: given, refused, or not asked yet. Nothing is pre-selected. For given or refused you say which adult and how (in person, by phone, in writing); for not asked you give the reason, and you get a task to ask within 7 days. If consent is refused, no notification is drafted and the record says why. A later answer is recorded as a new entry with who and when; the original decision is never edited.

**Still needs:** a solicitor to confirm what counts as consent and who in the household can give it.

## 5. Emergency placements and the six-week B&B limit

**Now:** placing a family (children or a pregnant member) in B&B or shared accommodation asks for an emergency reason (a choice plus your own words) and a move-on plan: the date to move by, no later than six weeks; the route being pursued; and a named person who owns it. It always needs a manager's approval. The placement page counts the days used against the 42. Weekly move-on reviews go to the plan's owner, the team manager is brought in on day 28, it turns urgent on day 35, and the head of service gets it on day 42. If the limit is passed, the record shows it, worked out from the dates, so it cannot be hidden.

For a family at the door at night, "Placed out of hours, approval to follow" lets you go ahead with a reason; a manager must approve by 10:00 the next working day, and the record says so prominently.

**Still needs:** reminders by email (see point 7), bank holidays in the working-day rule, and a solicitor to confirm how the days are counted.

## 6. Staff logins and permissions

**Now:** you sign in before you can do anything, and every record names the signed-in person; there are no typed names. Officers search, decide and move placements on; team managers and the head of service approve exceptions (an override, out of area, B&B for a family, a stay past six weeks, "no suitable option"), and never their own; only the head of service publishes policy; the auditor can read everything and change nothing. The rules are checked when something is saved, not just by hiding buttons, and a greyed-out button says why.

**Still needs:** real sign-in. The demo's sign-in lets you pick a pretend member of staff with no password, so a demo can show the officer and manager views. The pilot uses the council's own sign-in with two-step verification, and a server that checks the same rules again.

## 7. Warnings become tasks

**Now:** anything that needs doing becomes a task with an owner (a person or a team's queue) and a due time: notices to the receiving council and to schools and health services, asking for consent, confirming with the provider before a hold runs out, approvals, reviewing a refusal, the six-week reviews, stays and availability ending, and certificates expiring. Tasks show as due soon, overdue, then escalated to the manager. Completing one needs a note of what was done and a reference (an email, a call, a document). A manager can reassign a task or cancel it with a reason. The Tasks screen shows mine, my team's and all; the menu shows counts.

**Still needs:** a server for emailed reminders. Today reminders are in the app only, and the Tasks screen says so.

## 8. Real travel and cost information

**Journey times, now:** each place keeps its own arrive-by time, and journeys are planned for a normal school morning: the first Tuesday, Wednesday or Thursday from the date needed, avoiding the summer, Christmas and Easter holidays. The product is ready to use timetable-based public transport times from TravelTime, a commercial journey-time service. Until the council's account is switched on, it uses the same estimate as before, from straight-line distance, and **says so at the top of every results page** ("Estimated journey times (TravelTime not used). Real journey times are not switched on for this site yet, so these are estimates from straight-line distance"). Once it is on, the results say "Public transport times from TravelTime" with the day used. If TravelTime cannot be reached, refuses the request or misses some journeys, the product uses the estimate for those journeys and says why, as a warning. Every journey is marked "TravelTime" or "Estimate" on the property page, the comparison, the audit pack and the PDF, so nobody, including a court later, can mistake an estimate for a real journey.

**Places, now:** besides the invented example schools and services (now labelled as examples), you can add a real place by postcode: type the postcode of the school, workplace or clinic, name it and say who goes there. If the postcode is not found or the lookup is down, it tells you and the rest of the form carries on working. Please do not enter the household's own address there.

**Subsidy figures, now:** every cost that uses housing benefit subsidy says whether the figures are "Illustrative" or "Official", on the results, the comparison, the decision screen, the audit pack and the PDF. They are illustrative today. The head of service can load the official DWP January 2011 LHA table from a spreadsheet file on the policy screen: it checks the file (the right columns, no area twice, weekly amounts that make sense), shows it, shows what changes against the current table, and needs the source and its date and a confirmation that it is the official table. It is then published as a new signed policy version, and new searches say "Official subsidy table". Past decisions keep the figures they were made with. School transport fares and taxi rates are shown as the council's own assumptions.

**Still needs:** a TravelTime account for the council, with permission from TravelTime to keep their times in the decision records; the official January 2011 LHA table as a file, from the council or DWP; and the council's benefits team to confirm the subsidy calculation. Real school and GP lists (rather than typing postcodes) can follow.

## 9. Complete the booking process

**Now:** a decision holds the property for 24 hours. From the placement page you record, in order: the provider's confirmation (who, and their booking reference), the offer (and how it was made), the household's acceptance, or their refusal in their own words (which goes to a manager to review; the product draws no conclusion from it), the move-in date, and the move-out date with the reason and where they went. A hold nobody confirms simply lapses and frees the property. A stay can be extended after checking nobody else holds the property for the new dates. Each step is recorded with who and when, and the audit pack tells the whole story in order.

**Still needs:** provider confirmation straight from the booking platform (Adam) rather than typed in, which needs a council on board.

## 10. Connect to council systems

**Now:** two things work without any connection to the council's systems:

- **Bringing a household in.** On the new placement screen, "Import from the case system" reads a file in a published format (two invented example files are built in). It fills in the form for you to check, lists anything in the file it does not use, and runs the same checks as typing it in. It never searches by itself: you check, fix what is marked, and press "Find placements". A wheelchair user with no access answers in the file still cannot be searched until you answer the questions. The record says the details were imported, from which system and by whom.
- **Sending the decision out.** From the audit pack you can download the PDF, a case note in plain text to paste into the case system, and the sealed record in a form other systems can check; from the audit log, a spreadsheet of all placements. Every export is itself recorded: who, when, what, and a fingerprint of exactly what left. (The demo file you can pass round copies instead of downloading.)

**Still needs:** as you said, a council on board. Live links to Jigsaw, Locata, NEC or Adam need the council to arrange access with its suppliers, and a proper server. The formats are written up so that work can start straight away when that happens. We have not built anything that pretends to be connected.

## What would turn this into a pilot

- A proper server in the UK (data shared between officers, real sign-in, emailed reminders).
- A TravelTime account and their permission to store journey times; the official LHA table; the council's term dates.
- A solicitor's review of the legal wording, and the data protection paperwork.
- A council willing to try it in shadow mode alongside its current process.
