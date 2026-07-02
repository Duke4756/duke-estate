from playwright.sync_api import sync_playwright

TODOS = ["ซื้อกาแฟ", "ประชุมทีม", "ทำรีพอร์ต"]
URL = "https://demo.playwright.dev/todomvc"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 900, "height": 650})
    page.goto(URL, wait_until="networkidle")

    new_todo = page.get_by_placeholder("What needs to be done?")
    for item in TODOS:
        new_todo.click()
        new_todo.fill(item)
        new_todo.press("Enter")

    # Wait for all items to render
    page.wait_for_selector(".todo-list li")
    count = page.locator(".todo-list li").count()
    print(f"Number of todo items on page: {count}")

    items = page.locator(".todo-list li label").all_inner_texts()
    print("Items:", items)
    print("Counter text:", page.locator(".todo-count").inner_text())

    page.screenshot(path="/home/claude/todomvc.png", full_page=True)
    print("Screenshot saved.")

    browser.close()