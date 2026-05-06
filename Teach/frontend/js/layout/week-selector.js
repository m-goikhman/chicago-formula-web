window.TeachWeekSelector = (() => {
    function getWeekEpisodeMeta(week, index) {
        const fallbackNumber = index + 1;
        const title = String(week?.title || '').trim();
        const match = title.match(/^week\s*(\d+)\s*(?:[·:-]\s*)?(.*)$/i);
        const number = match ? Number(match[1]) : fallbackNumber;
        const name = match ? String(match[2] || '').trim() : title;
        return {
            number,
            title: name || title || `Week ${fallbackNumber}`
        };
    }

    function closeWeekSelectorDropdown() {
        const selector = document.getElementById('episodeSelector');
        const dropdown = document.getElementById('episodeDropdown');
        if (!selector || !dropdown) {
            return;
        }
        selector.classList.remove('dropdown-open');
        dropdown.style.display = 'none';
    }

    function renderWeekSelector(weeks, currentWeekId, callbacks = {}) {
        const selector = document.getElementById('episodeSelector');
        const display = document.getElementById('episodeDisplay');
        const dropdown = document.getElementById('episodeDropdown');
        if (!selector || !display || !dropdown) {
            return;
        }

        if (!weeks || weeks.length === 0) {
            selector.classList.remove('has-dropdown', 'dropdown-open');
            display.textContent = 'Episode';
            dropdown.style.display = 'none';
            dropdown.innerHTML = '';
            return;
        }

        const currentWeekIndex = Math.max(
            0,
            weeks.findIndex((week) => week.id === currentWeekId)
        );
        const currentWeek = weeks[currentWeekIndex] || weeks[0];
        const currentMeta = getWeekEpisodeMeta(currentWeek, currentWeekIndex);
        display.textContent = `Episode ${currentMeta.number}`;

        closeWeekSelectorDropdown();
        dropdown.innerHTML = '';

        const availability = callbacks.weekAvailability instanceof Map
            ? callbacks.weekAvailability
            : new Map();

        weeks.forEach((week, index) => {
            const item = document.createElement('div');
            item.className = 'episode-dropdown-item';
            const weekAvailability = availability.get(week.id);
            const isLocked = Boolean(weekAvailability?.locked);

            if (week.id === currentWeekId) {
                item.classList.add('current');
            }
            if (isLocked) {
                item.classList.add('locked');
            }

            const meta = getWeekEpisodeMeta(week, index);
            const nameSpan = document.createElement('span');
            nameSpan.className = 'episode-name';
            nameSpan.textContent = `Episode ${meta.number}: ${meta.title}`;

            const statusSpan = document.createElement('span');
            statusSpan.className = 'episode-status';
            if (week.id === currentWeekId) {
                statusSpan.textContent = 'Current';
            } else if (isLocked) {
                statusSpan.textContent = 'Locked';
            } else {
                statusSpan.textContent = 'Available';
            }

            item.appendChild(nameSpan);
            item.appendChild(statusSpan);

            item.addEventListener('click', () => {
                if (isLocked) {
                    return;
                }
                callbacks.onSelect?.(week.id);
                closeWeekSelectorDropdown();
            });

            dropdown.appendChild(item);
        });

        if (weeks.length <= 1) {
            selector.classList.remove('has-dropdown');
            display.style.cursor = 'default';
            return;
        }

        selector.classList.add('has-dropdown');
        display.style.cursor = 'pointer';
        display.onclick = (event) => {
            event.stopPropagation();
            const isOpen = selector.classList.toggle('dropdown-open');
            dropdown.style.display = isOpen ? 'block' : 'none';
        };

        if (document.body.dataset.teachSelectorOutsideHandlerBound !== 'true') {
            document.addEventListener('click', (event) => {
                if (!selector.contains(event.target)) {
                    closeWeekSelectorDropdown();
                }
            });
            document.body.dataset.teachSelectorOutsideHandlerBound = 'true';
        }
    }

    return {
        getWeekEpisodeMeta,
        closeWeekSelectorDropdown,
        renderWeekSelector
    };
})();
