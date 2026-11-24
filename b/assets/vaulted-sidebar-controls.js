(() => {
  const installCollapseButton = () => {
    const sidebar = document.querySelector(".vaulted-topnav");
    if (!sidebar || sidebar.querySelector(".vaulted-sidebar-collapse")) return;

    const firstCategory = sidebar.querySelector("[data-category]");
    if (!firstCategory) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "vaulted-sidebar-collapse";
    button.setAttribute("aria-label", "Collapse sidebar");
    button.setAttribute("aria-expanded", "true");
    button.innerHTML = '<span>Collapse</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4-4 4 4M4 10l4 4 4-4"/></svg>';
    button.addEventListener("click", () => {
      const collapsed = sidebar.classList.toggle("vaulted-sidebar-collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      button.querySelector("span").textContent = collapsed ? "Expand" : "Collapse";
    });
    sidebar.insertBefore(button, firstCategory);
  };

  installCollapseButton();
  new MutationObserver(installCollapseButton).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
