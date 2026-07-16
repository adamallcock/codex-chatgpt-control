# Consult Patterns

This reference supports the backward-compatible `chatgpt-pro-consult` alias.
Prefer `chatgpt-delegate` for new Chat or Work delegation. Use the visible Chat
Pro intelligence setting for a bounded second opinion, not as verified truth or
as proof of a specific underlying model.

Good consult requests include:

- the decision being made
- the current plan or artifact
- the specific critique requested
- known constraints
- what kind of output should come back

Recommended sections:

- Executive recommendation
- Highest-risk assumptions
- Concrete improvements
- What not to build
- Verification or evidence needed
- Open questions

For current, legal, medical, financial, or other high-stakes claims, verify with primary sources before presenting the result as fact.

For long-running Pro responses, submit once and keep polling the same thread. Do not duplicate prompts after a timeout. Treat `completionState: "generating"` or `generationActive: true` as proof that ChatGPT Pro is still running, not as a failed or finished answer.
