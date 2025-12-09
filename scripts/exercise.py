import httpx
import sys
import re
from collections import Counter
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from rich.prompt import Prompt

# --- CONFIGURATION ---
BASE_URL = "http://localhost:8000"
EXERCISES_URL = f"{BASE_URL}/exercises"
RESULTS_URL = f"{BASE_URL}/results"

WORD_BANK_INTERVAL = 5  # Show word bank every N questions

console = Console(color_system='truecolor')

def get_latest_exercises():
    try:
        response = httpx.get(EXERCISES_URL)
        response.raise_for_status()
        data = response.json()

        if not data:
            console.print("[bold red]No exercises found. Run the generator first![/bold red]")
            sys.exit(1)

        return data[0]["exercises"]

    except httpx.RequestError:
        console.print(f"[bold red]Could not connect to API at {BASE_URL}.[/bold red]")
        sys.exit(1)

def submit_results(results_vector):
    """Submits a list of 0/1 integers to the API."""
    console.print("\n[dim]Submitting results to server...[/dim]")
    try:
        payload = {"results": results_vector}
        response = httpx.post(RESULTS_URL, json=payload)
        if response.status_code in [200, 201]:
            console.print("[bold green]Results saved successfully![/bold green]")
        else:
            console.print(f"[red]Server returned status {response.status_code}[/red]")
    except httpx.RequestError:
        console.print("[yellow]Could not reach server to save results (API might not exist yet).[/yellow]")

def normalize(text):
    """Strip punctuation and lowercase for comparison."""
    return re.sub(r'[^\w\s]', '', text).lower().strip()

def mask_sentence(sentence, word):
    pattern = re.compile(re.escape(word), re.IGNORECASE)
    return pattern.sub("___", sentence)

def format_correction(sentence, target_word, user_word):
    """
    Replaces the target word in the sentence with: ~~user_word~~ **target_word**
    """
    pattern = re.compile(re.escape(target_word), re.IGNORECASE)
    user_display = user_word if user_word else "___"
    replacement = f"[strike red]{user_display}[/strike red] [bold green]{target_word}[/bold green]"
    return pattern.sub(replacement, sentence)

def display_word_bank(all_words, user_answers_values):
    """
    Displays the word bank. Handles duplicate words correctly by counting usage.
    """
    styled_words = []

    # Count frequencies of user answers to handle duplicates
    # e.g., if "de" is used once, count is 1. If "de" is in word bank twice,
    # only the first instance gets struck.
    user_counts = Counter(normalize(w) for w in user_answers_values if w)

    # Sort purely alphabetically for display
    for word in sorted(all_words):
        norm = normalize(word)
        if user_counts[norm] > 0:
            # Strike through and decrement usage count so we don't strike duplicates
            # unless the user actually used the word multiple times.
            styled_words.append(f"[dim strike]{word}[/dim strike]")
            user_counts[norm] -= 1
        else:
            styled_words.append(f"[cyan]{word}[/cyan]")

    text_content = ", ".join(styled_words)
    console.print(Panel(text_content, title="📖 Word Bank (Remaining options)", expand=False))

def display_question(index, exercise, total, current_answer=None, is_replay=False):
    target_word = exercise['word']
    original_sentence = exercise['sentence']
    masked = mask_sentence(original_sentence, target_word)

    header = f"Exercise {index + 1}/{total}"
    if is_replay:
        header += " [italic yellow](Reviewing)[/italic yellow]"

    content = Text()
    content.append(masked, style="bold cyan")

    if current_answer:
        content.append(f"\n\nCurrent Answer: ", style="dim")
        content.append(current_answer, style="bold yellow")

    console.print(Panel(content, title=header))

def main():
    console.print("[bold magenta]🇳🇱 Welcome to Your Daily Dutch Exercise![/bold magenta]")
    console.print("Loading exercises...")

    exercises = get_latest_exercises()
    total = len(exercises)

    # Keep the raw list (including duplicates)
    word_bank_list = [e['word'] for e in exercises]

    console.print("[dim]Instructions: Type the missing word. Type a number to jump.[/dim]\n")

    user_answers = {}  # {index: "answer_string"}
    current_index = 0
    farthest_index = 0

    # --- MAIN INPUT LOOP ---
    while current_index < total:
        is_replay = current_index < farthest_index

        # Word Bank Display Logic
        if not is_replay and (current_index == 0 or current_index % WORD_BANK_INTERVAL == 0):
            display_word_bank(word_bank_list, user_answers.values())

        exercise = exercises[current_index]
        existing_ans = user_answers.get(current_index)

        display_question(current_index, exercise, total, existing_ans, is_replay)

        prompt_text = "[bold green]Your answer (or # to jump): [/bold green]"
        user_input = console.input(prompt_text).strip()

        # Logic: Jump
        if user_input.isdigit():
            target = int(user_input) - 1
            if 0 <= target < total:
                console.print(f"[yellow]>> Jumping to exercise {target + 1}...[/yellow]")
                current_index = target
            else:
                console.print("[red]Invalid number.[/red]")
            continue

        # Logic: Input Handling
        if user_input:
            user_answers[current_index] = user_input
        elif not existing_ans:
             console.print("[dim]Skipped.[/dim]")

        # Navigation Logic
        if is_replay:
            console.print(f"[yellow]>> Updated. Returning to exercise {farthest_index + 1}...[/yellow]")
            current_index = farthest_index
        else:
            current_index += 1
            farthest_index = current_index

    # --- END CONFIRMATION ---
    console.print("\n" + "="*50)
    missing = [i+1 for i in range(total) if i not in user_answers]
    if missing:
        console.print(f"[red]Warning: You skipped: {missing}[/red]")

    while True:
        choice = Prompt.ask("Type [bold]submit[/bold] to finish, or a [bold]number[/bold] to review", default="submit")
        if choice.lower() == "submit":
            break
        elif choice.isdigit():
            target = int(choice) - 1
            if 0 <= target < total:
                console.print(f"[yellow]>> Reviewing exercise {target + 1}...[/yellow]")
                display_question(target, exercises[target], total, user_answers.get(target), is_replay=True)
                rev_input = console.input("[bold green]New answer (Enter to keep): [/bold green]").strip()
                if rev_input:
                    user_answers[target] = rev_input
                    console.print("[green]Updated.[/green]")
                console.print("[yellow]>> Returning to submission menu...[/yellow]")

    # --- EVALUATION ---
    console.print("\n[bold]Evaluating Answers...[/bold]\n")

    score = 0
    results_vector = []
    incorrect_indices = []

    table = Table(title="Final Results", show_lines=True)
    table.add_column("#", style="dim", width=4)
    table.add_column("Your Answer", ratio=1)
    table.add_column("Correct Word", style="green", ratio=1)
    table.add_column("Result", justify="center")

    for i in range(total):
        correct_word = exercises[i]['word']
        user_ans = user_answers.get(i, "")

        is_correct = normalize(user_ans) == normalize(correct_word)

        if is_correct:
            score += 1
            results_vector.append(1)
            table.add_row(str(i + 1), user_ans, correct_word, "✅")
        else:
            results_vector.append(0)
            incorrect_indices.append(i)
            style = "red strike" if user_ans else "dim"
            table.add_row(str(i + 1), Text(user_ans or "(empty)", style=style), correct_word, "❌")

    console.print(table)

    percentage = int((score / total) * 100)
    console.print(Panel(f"Score: {score}/{total} ({percentage}%)", expand=False, style="bold blue"))

    # --- MISTAKE REVIEW ---
    if incorrect_indices:
        console.print("\n[bold red]Reviewing Mistakes:[/bold red]")
        for i in incorrect_indices:
            ex = exercises[i]
            user_ans = user_answers.get(i, "")
            corrected_sentence = format_correction(ex['sentence'], ex['word'], user_ans)

            console.print(f"\n[bold]{i+1}.[/bold] {corrected_sentence}")
            if ex.get('english'):
                console.print(f"   [italic dim]{ex['english']}[/italic dim]")
    else:
        console.print("\n[bold green]Flawless victory! No mistakes to review.[/bold green]")

    submit_results(results_vector)

if __name__ == "__main__":
    main()
