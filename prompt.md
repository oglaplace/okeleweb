in the request path graph you can see that the request leaves clients browser 
then hits fastify plugin first (let's keep it basic, what's a plugin here, and what's 
why fastify plugin here?)
then can you explain the graph a lil bit better, breaking it down further?


can you explain what's meant in this passage? 
"THE TWO GUARDS THAT MATTER
findUnique is BANNED on tenant models — Prisma rejects a non-unique field in its where, so the
tenant predicate cannot be injected and it would silently bypass isolation. Use findFirst.
Write routing lives in requireAuth, not per route, so a new endpoint cannot forget it."

first explain this passage: "Every domain table carries tenantId as a plain indexed scalar with no 
relation field — relating 43 models back to Tenant would make it a wall of relations 
for no benefit. The filter is injected instead, and the current tenant travels in 
AsyncLocalStorage rather than through every service signature." 
what's a 'plain indexed scalar' is it like an id type field that you can use to find a row quickly?
"wall of relation"? and what's bad about it in this case?
this block is also important: "The filter is injected instead, and the current tenant travels in 
AsyncLocalStorage rather than through every service signature." break it down further and what's
"AsyncLocalStorage" and why is it a good fit in this case?

the section "Why one forgotten where cannot leak a school's grades" from the file was not
properly understood, can you explain it along with the graph that goes below it.


have a look at this chunk: "a complex-level finance manager who must see every school's 
money and none of its grades. A rank can only say how much authority."
so a proposed solution was to use Grant as a combination of ROLE+SCOPE+PERMISSION how does 
that solve this issue really and can you breakdown how each piece of the grant helps and 
what they actually do
what's actually meant by "OVER WHAT — the scope subtree, resolved by walking OrgUnit children.
WHICH KIND — the permission set, a string array so features do not need migrations"
and i also had a look at the endpoint table and the guard section there showed stuff like
"finance.write" what does that mean exactly and how does that play to how the grand 
mechanism works? 

regarding the SYSCOHADA LEDGER, i heard SYSCOHADA is the unified accounting system used 
by businesses across 17 member states in West and Central Africa to standardize financial
reporting. does that mean that the table in the DB are SYSCOHADA compliant or the app would
provide SYSCOHADA compliant financial reports?
