# Description

Write the core functionality for a multi-agent framework that has the following properties: 

- New agents should be registered by a registerAgent(name) method which are stored in a java object { <agent-name>: {} } in variable called 'agents'. This will become an event driven state store for the agents memory, prompts, goal tracking, task tracking and interactions. They should also indicate the claude model they are using. 

- An instance of the agent-core will always be a singleton. It should never be instantiated by consumer classes, only a reference can be imported. 

- It will eventually be wrapped in a CLI, so it should always assume that directory path. 

- It will have first class snapshotting, where it can persist to a state directory inside the launch directory called ./.claude-looper/state.json. It should be able to load that state too and also be able to resume where it left off.

- Whenever the state for anything inside the agent state is changed is should fire an event with an event object detailing the agent source that changed, the change type and the object that was modified, added or removed and with the entire state object for the agent. This will eventually for the basis for agentic interactions for example how a supervisor would ensure things are done correctly, or how a planner would make sure the goals and tasks are tracked efficiently, or how a coder would implement a specific task or even how a tester would make sure that the feature works. Each event could generate a response, which in turn could trigger more events. 

- Agents should then be able to easily implement themselves by importing this instance and registering themselves (with custom state for memory, snapshotting) and their events will eventually be connected to form workflows between them.

# Examples

- Examples of agents would include: 

 - agent-supervisor.js -> which will contain system prompts to critique the output of any other agent to ensure the work aligns to the goal or task at hand. To make sure things are done correctly, the results are verifiable, have evidence and there are no gaps in the implementation or work the agent does. 

 - agent-planner.js -> this agent will accept a brief description of a goal, break it down into tasks and track the completion of those tasks. If any task is not achievable within 3 iterations, it will engage in replanning the task to break it down even further until it is achievable. The supervisor checks outputs and make sure the plan is achievable and does not have any gaps.  

 - agent-coder.js -> this agent will implement the programming task to the best standards possible. It should be allowed to ask the planner questions and re-plan any task that seems unclear. It will implement the current task, once complete, hand it over to the supervisor and then the supervisor will instruct the planner to mark the task as complete or ask the coder the implement any gaps whilst ensuring the overall alignment to the goal. 

 - agent-tester.js -> this agent will accept handoffs from the coding agent, write any tests that are required and make sure the tests all pass. It should also be allowed to ask the planner questions and create plans for tracking it's work. Once complete it will also hand off to the supervisor which will do the assessment and then either decide if the goal, task or sub-task is complete or not. 

# Guiding Principles

All the infrastructure for tracking state, snapshotting and events should be contained inside the agent-core.js implementation. 

All the implementations inside the agent-core should always be generic. No agent specific logic should ever go inside the agent-core.js. 

It is about state tracking and events. 

Agent wrappers can be implemented around the agent-core.js to test out the implementation to see everything working. 

There is no condition under which the application will exit until the work is done. This agent implementation should be fully autonomous, continuous, un-attended and will not stop until the goal is achieved. 

Response from invoking claude code for signalling completion should be modelled as tool calls. This is to avoid string based pattern matching or regex parsing which can be a nightmare to maintain. 

The entire configuration should be data driven as much as possible to avoid boiler plate coding for bespoke edge cases which quickly get out of control.  

The prompts should be stored in separate files using proper templating as a first class citizen. Do not mix prompt templates and code. Templates should be loaded, transformed and then submitted to the claude code cli. The results eg. planning completion, coding completion, testing completion should be signalled via a tool call that is implemented inside the respective agent wrapper.  

# Agents actually doing work

The will be executed against the claude code cli. There is already an implementation of how this is done in this project. Explore it and capture the essence of it and place it inside the agent-executor.js. These will effectively be called by agent wrappers, the responses will then be record to their state inside the agent-core which will trigger events causing other agents to kick in, doing work until the supervisor signs off on the goal. 

# Workflows

The agents, prompt templates and how they communicate will be modelled using a workflow file from the current state directory called ./.claude-looper/configuration.json. A simple example could include: 

{
  "default-workflow": {
    "supervisor": {
      model: "opus",
      subscribesTo: ["planner", "coder", "tester"],
      tools: [{
        acceptOrReject: {
          params: [{
            name: "goal",
            type: "string"
          }, {
            name: "agentOutput",
            type: "string"
          }]
        }
      }]
    },
    "planner": {
      model: "sonnet",
      subsribesTo: ["supervisor", "coder", "tester"],
      tools: [...]
    },
    "coder": {
      model: "opus", 
      subscribesTo: ["supervisor", "planner"]
      tools: [...]
    },
    "tester": {
      modle: "opus",
      subscribesTo: ["supervisor", "planner"],
      tools: [...]
    }
  }
}

The implementation should be integration tested for the simplist use-cases possible with full integration with the claude code cli. The tests are light but always guarentee the entire system works correctly and only have possitive test cases. 

# Finally

Keep the implementation as simple as possible, data driven, signalling and results are modelled as tool calls and prompts are templated. This should be easily extendable by a human in the future. 

All implementation happens inside src/experiments. Do not change any code outside this folder. Create a new package.json to track dependencies and make it easy to install this globally and test using npm run scripts.