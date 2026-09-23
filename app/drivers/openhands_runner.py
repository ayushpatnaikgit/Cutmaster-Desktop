"""Run one episode job with the OpenHands SDK, in a local workspace.

Called by drivers/openhands.mjs. Prints one line per agent event so the web app
can stream it. The workspace is the job's work/ directory; tools run on this
machine so they can reach ffmpeg, Chrome and Remotion.
"""
import json, os, sys
from pathlib import Path

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")

from openhands.sdk import LLM, Agent, Conversation
from openhands.sdk.tool import Tool, register_tool
from openhands.tools import TerminalTool, FileEditorTool, TaskTrackerTool

work = Path(sys.argv[1]).resolve()
model = sys.argv[2] if len(sys.argv) > 2 else "gemini-3.8-flash"
api_key = os.environ["GEMINI_API_KEY"]

SYSTEM = """You are an expert video editor working inside a prepared workspace.
Read AGENTS.md — it is how you work — then the task file below, which is the
request in the person's own words. They are watching from a web app; talk to them with
scripts/ask-user.py when you need a decision. Verify everything you claim, look
at your own frames with scripts/look.py, and do not finish while a detached
render is still running."""

def emit(kind, text):
    print(json.dumps({"kind": kind, "text": str(text)[:4000]}), flush=True)

for name, cls in (("TerminalTool", TerminalTool), ("FileEditorTool", FileEditorTool), ("TaskTrackerTool", TaskTrackerTool)):
    try:
        register_tool(name, cls)
    except Exception:
        pass

llm = LLM(
    model=f"gemini/{model}",
    api_key=api_key,
    temperature=0.4,
    usage_id="episode",
)

agent = Agent(
    llm=llm,
    tools=[
        # Renders and transcodes are silent for minutes; the default 30s
        # "no output change" timeout makes the agent think they stalled.
        Tool(name="TerminalTool", params={"no_change_timeout_seconds": 900}),
        Tool(name="FileEditorTool"),
        Tool(name="TaskTrackerTool"),
    ],
    system_prompt_kwargs={},
)

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
    persistence_dir=os.environ.get("OH_STATE_DIR", str(work.parent / "openhands-state")),
)

task_file = os.environ.get("TASK_FILE", "TASK.md")
task = (work / task_file).read_text()
conversation.send_message(
    SYSTEM + "\n\nYour workspace is the current directory. The request:\n\n" + task
)
conversation.run()

emit("status", "OpenHands conversation finished")

# The agent may declare itself finished while a detached render it started is
# still running. Don't judge the run until every run-long.sh job has exited.
import time

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
