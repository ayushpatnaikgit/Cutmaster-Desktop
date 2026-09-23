"""Run one episode job with the OpenHands SDK, in a local workspace.

Called by drivers/openhands.mjs. Prints one line per agent event so the web app
can stream it. The workspace is the job's work/ directory; tools run on this
machine so they can reach ffmpeg, Chrome and Remotion.
"""
import json, os, re, sys, threading

# Files the agent makes stay writable by the app (they share a group in Docker).
os.umask(0o002)
from pathlib import Path

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")

from openhands.sdk import LLM, Agent, Conversation
from openhands.sdk.context.agent_context import AgentContext
from openhands.sdk.context.condenser import default_condenser
from openhands.sdk.conversation.visualizer import DefaultConversationVisualizer
from openhands.sdk.conversation.visualizer.base import ConversationVisualizerBase
from openhands.sdk.event import ActionEvent, MessageEvent
from openhands.sdk.subagent import register_agent
from openhands.sdk.subagent.schema import AgentDefinition
from openhands.sdk.tool import Tool, register_tool
from openhands.tools import TerminalTool, FileEditorTool, TaskTrackerTool
from openhands.tools.task import TaskToolSet

work = Path(sys.argv[1]).resolve()
model = sys.argv[2] if len(sys.argv) > 2 else "gemini-3.8-flash"
api_key = os.environ["GEMINI_API_KEY"]

SYSTEM = """You are an expert video editor working inside a prepared workspace.
Read AGENTS.md — it is how you work — then the task file below, which is the
request in the person's own words. You lead a small team: hand self-contained
jobs (each graphic, web research, page captures) to subagents with the `task`
tool, several calls in one step so they run in parallel. They are watching from a web app; talk to them with
scripts/ask-user.py when you need a decision. Verify everything you claim, look
at your own frames with scripts/look.py, and do not finish while a detached
render is still running."""

def emit(kind, text):
    print(json.dumps({"kind": kind, "text": str(text)[:4000]}), flush=True)

for name, cls in (("TerminalTool", TerminalTool), ("FileEditorTool", FileEditorTool), ("TaskTrackerTool", TaskTrackerTool), (TaskToolSet.name, TaskToolSet)):
    try:
        register_tool(name, cls)
    except Exception:
        pass

# The key never reaches this process: api_key is a job token, and base_url is
# the Elyps app's local proxy, which swaps in the real key.
llm = LLM(
    model=f"gemini/{model}",
    api_key=api_key,
    base_url=os.environ.get("GEMINI_BASE_URL") or None,
    temperature=0.4,
    usage_id="episode",
)

# Renders and transcodes are silent for minutes; the default 30s
# "no output change" timeout makes the agent think they stalled.
TERMINAL = Tool(name="TerminalTool", params={"no_change_timeout_seconds": 900})

# ---- subagents: the lead agent hands self-contained jobs to these, several at
# once (every `task` call in one step runs in parallel). Each reads its own
# playbook in the workspace, works in the same sandbox, and reports back.
SUBAGENTS = {
    "graphics": (
        "Designs, animates, renders and checks ONE graphic (html/clips/<key>.js) from a brief. "
        "Use one per graphic, several in parallel.",
        "You are a motion designer on a video team. Read GRAPHICS.md in the workspace: it is how you "
        "work. You own exactly one graphic, named in your brief. Write only html/clips/<key>.js "
        "(and new images under public/img/ with your key as prefix). Never edit other clips, "
        "clips.js, scenes.js, episode.json or src/. Iterate until the frames look right, then "
        "reply with the key, what the graphic shows, when each element enters, and the stills you checked.",
        160,
    ),
    "research": (
        "Looks things up on the web (the speaker, an organisation, a claim in the talk, a site to "
        "show) and captures pages as screenshots or scrolling recordings with highlights.",
        "You are a researcher on a video team. Read RESEARCH.md in the workspace: it is how you work. "
        "Only report what a source says, with its URL. Save captures under public/web/. Reply with "
        "the facts (each with its source), and every capture you made with what it shows.",
        80,
    ),
}


def _subagent_factory(prompt, max_iter):
    def factory(sub_llm):
        return Agent(
            llm=sub_llm,
            tools=[TERMINAL, Tool(name="FileEditorTool")],
            agent_context=AgentContext(system_message_suffix=prompt),
            condenser=default_condenser(sub_llm.model_copy(update={"usage_id": "condenser"})),
        )
    return factory


for kind, (desc, prompt, max_iter) in SUBAGENTS.items():
    try:
        register_agent(kind, _subagent_factory(prompt, max_iter),
                       AgentDefinition(name=kind, description=desc, tools=["TerminalTool", "FileEditorTool"],
                                       system_prompt=prompt, max_iteration_per_run=max_iter))
    except ValueError:  # already registered
        pass

agent = Agent(
    llm=llm,
    tools=[TERMINAL, Tool(name="FileEditorTool"), Tool(name="TaskTrackerTool"), Tool(name=TaskToolSet.name)],
    # several `task` calls in one step run at once: that is how graphics are
    # built in parallel
    tool_concurrency_limit=6,
    system_prompt_kwargs={},
)


# The app reads the lead agent's steps from the standard printout ("$ cmd",
# "Summary: …"). Subagents print the same lines, tagged "@@sub:<name> ", so the app
# can show who is doing what.
_print_lock = threading.Lock()


def say(line):
    with _print_lock:
        print(line, flush=True)


class SubagentLines(ConversationVisualizerBase):
    def __init__(self, name):
        super().__init__()
        self._name = name
        self.tag = "@@sub:" + (re.sub(r"[^\w.-]+", "-", name.strip()).strip("-")[:40] or "helper")

    def on_event(self, event):
        try:
            if isinstance(event, ActionEvent):
                if event.tool_name == "finish":  # subagents end with a finish action
                    say(f"{self.tag} Done")
                    return
                if event.summary:
                    say(f"{self.tag} Summary: {str(event.summary).splitlines()[0][:200]}")
                cmd = getattr(event.action, "command", None)
                if event.tool_name == "file_editor" and getattr(event.action, "path", None):
                    say(f"{self.tag} $ edit {event.action.path}" if cmd != "view" else f"{self.tag} $ view {event.action.path}")
                elif isinstance(cmd, str) and cmd.strip():
                    say(f"{self.tag} $ {cmd.strip().splitlines()[0][:300]}")
            elif isinstance(event, MessageEvent) and event.source == "agent":
                say(f"{self.tag} Done")
        except Exception:
            pass


class ElypsVisualizer(DefaultConversationVisualizer):
    def create_sub_visualizer(self, agent_id):
        return SubagentLines(agent_id)

def on_event(event):
    kind = type(event).__name__
    text = ""
    for attr in ("thought", "content", "command", "message", "text", "observation"):
        v = getattr(event, attr, None)
        if v:
            text = v if isinstance(v, str) else str(v)
            break
    if not text:
        text = str(event)
    emit(kind, text)

emit("status", f"OpenHands starting in {work} with gemini/{model}")

conversation = Conversation(
    agent=agent,
    workspace=str(work),
    callbacks=[on_event],
    visualizer=ElypsVisualizer(),
    persistence_dir=os.environ.get("OH_STATE_DIR", str(work.parent / "openhands-state")),
)

task_file = os.environ.get("TASK_FILE", "TASK.md")
task = (work / task_file).read_text()
conversation.send_message(
    SYSTEM + "\n\nYour workspace is the current directory. The request:\n\n" + task
)
# Messages the person sends while the agent works (the app writes them to the
# job's inbox). send_message is safe to call while run() is going: the agent
# sees the note at its next step, like being interrupted mid-task.
import time

NOTE = (
    "The person just sent you a message while you were working:\n\n"
    "\"{text}\"\n\n"
    "Take it into account from now on. If it changes what you're doing, adjust now and "
    "say in one line what you're changing (no need for ask-user). Then carry on."
)
inbox = Path(os.environ.get("STUDIO_JOB_DIR", str(work.parent))) / "inbox"

def watch_inbox():
    seen = set()
    while True:
        try:
            for f in sorted(inbox.glob("*.json")):
                if f.name in seen:
                    continue
                seen.add(f.name)
                text = json.loads(f.read_text()).get("text", "").strip()
                if text:
                    conversation.send_message(NOTE.format(text=text))
                    emit("status", "The agent has your message")
        except Exception as e:  # never let the watcher take the run down
            emit("status", f"Couldn't read a message: {e}")
        time.sleep(2)

threading.Thread(target=watch_inbox, daemon=True).start()

conversation.run()

emit("status", "OpenHands conversation finished")

# The agent may declare itself finished while a detached render it started is
# still running. Don't judge the run until every run-long.sh job has exited.

def running_long_jobs():
    alive = []
    for pid_file in (work / "logs").glob("*.pid"):
        if (work / "logs" / (pid_file.stem + ".done")).exists():
            continue
        try:
            os.kill(int(pid_file.read_text().strip()), 0)
            alive.append(pid_file.stem)
        except (ValueError, ProcessLookupError, PermissionError):
            pass
    return alive

deadline = time.time() + 3 * 3600
pending = running_long_jobs()
if pending:
    emit("status", f"Waiting for detached jobs to finish: {', '.join(pending)}")
while pending and time.time() < deadline:
    time.sleep(30)
    pending = running_long_jobs()
if pending:
    emit("status", f"Gave up waiting after 3 hours on: {', '.join(pending)}")

done = (work / "out" / "episode.mp4").exists()
emit("status", f"episode.mp4 present: {done}")
sys.exit(0 if done else 2)
