window.TeachSuspectsDrag = (() => {
    function renderSuspectsDragExercise(messageEl, section) {
        if (!messageEl || messageEl.querySelector('.teach-suspects-exercise')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (messageText) {
            messageText.innerHTML =
                '<p>Drag each name card to the correct suspect in the image, then check your answers.</p>';
        }

        const boardImageUrl = 'images/suspects_names_to_add.png';
        const cardConfigs = [
            {
                id: 'tim',
                label: 'Tim',
                image: 'images/Tim_name.png'
            },
            {
                id: 'ronnie',
                label: 'Ronnie',
                image: 'images/Ronnie_name.png'
            }
        ];
        const zoneConfigs = [
            { id: 'ronnie', label: 'Ronnie slot', left: '48%', top: '42%' },
            { id: 'tim', label: 'Tim slot', left: '70%', top: '72%' }
        ];
        const correctPlacements = { tim: 'tim', ronnie: 'ronnie' };
        const placements = { tim: null, ronnie: null };
        let selectedCardId = null;

        const container = document.createElement('div');
        container.className = 'teach-suspects-exercise';

        const board = document.createElement('div');
        board.className = 'teach-suspects-board';

        const boardImage = document.createElement('img');
        boardImage.className = 'teach-suspects-board-image';
        boardImage.src = boardImageUrl;
        boardImage.alt = 'Suspects image with missing names';
        board.appendChild(boardImage);

        const zonesLayer = document.createElement('div');
        zonesLayer.className = 'teach-suspects-zones';
        board.appendChild(zonesLayer);

        const cards = document.createElement('div');
        cards.className = 'teach-suspects-cards';

        const actions = document.createElement('div');
        actions.className = 'teach-suspects-actions';

        const checkButton = document.createElement('button');
        checkButton.type = 'button';
        checkButton.className = 'teach-suspects-button primary';
        checkButton.textContent = 'Check answers';
        actions.appendChild(checkButton);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'teach-suspects-button secondary';
        resetButton.textContent = 'Reset';
        actions.appendChild(resetButton);

        const result = document.createElement('div');
        result.className = 'teach-suspects-result';

        function getZoneByCard(cardId) {
            return Object.entries(placements).find(([, assignedCard]) => assignedCard === cardId)?.[0] ?? null;
        }

        function clearResult() {
            result.textContent = '';
            result.classList.remove('success', 'error', 'warning');
        }

        function placeCard(cardId, zoneId) {
            if (!cardId || !zoneId) {
                return;
            }

            const previousZone = getZoneByCard(cardId);
            if (previousZone) {
                placements[previousZone] = null;
            }

            const cardAlreadyInTarget = placements[zoneId];
            if (cardAlreadyInTarget && cardAlreadyInTarget !== cardId) {
                const occupiedZone = getZoneByCard(cardAlreadyInTarget);
                if (occupiedZone) {
                    placements[occupiedZone] = null;
                }
            }

            placements[zoneId] = cardId;
            selectedCardId = null;
            clearResult();
            render();
        }

        function createCardButton(card) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'teach-suspects-card';
            button.dataset.cardId = card.id;
            button.draggable = true;
            button.setAttribute('aria-label', `Card ${card.label}`);

            const image = document.createElement('img');
            image.src = card.image;
            image.alt = `${card.label} name card`;
            button.appendChild(image);

            if (selectedCardId === card.id) {
                button.classList.add('selected');
            }

            button.addEventListener('click', () => {
                selectedCardId = selectedCardId === card.id ? null : card.id;
                render();
            });

            button.addEventListener('dragstart', (event) => {
                event.dataTransfer?.setData('text/plain', card.id);
                event.dataTransfer.effectAllowed = 'move';
                selectedCardId = card.id;
                button.classList.add('dragging');
            });

            button.addEventListener('dragend', () => {
                button.classList.remove('dragging');
                selectedCardId = null;
                render();
            });

            return button;
        }

        function createDroppedCardElement(cardId) {
            const card = cardConfigs.find((item) => item.id === cardId);
            if (!card) {
                return null;
            }

            const dropped = document.createElement('div');
            dropped.className = 'teach-suspects-card dropped';

            const image = document.createElement('img');
            image.src = card.image;
            image.alt = `${card.label} name card`;
            dropped.appendChild(image);

            return dropped;
        }

        function createZone(zone) {
            const zoneEl = document.createElement('button');
            zoneEl.type = 'button';
            zoneEl.className = 'teach-suspects-zone';
            zoneEl.dataset.zoneId = zone.id;
            zoneEl.style.left = zone.left;
            zoneEl.style.top = zone.top;
            zoneEl.setAttribute('aria-label', `Drop zone for ${zone.label}`);

            const assignedCardId = placements[zone.id];
            if (assignedCardId) {
                zoneEl.classList.add('filled');
                const droppedCard = createDroppedCardElement(assignedCardId);
                if (droppedCard) {
                    zoneEl.appendChild(droppedCard);
                }
            } else {
                zoneEl.textContent = 'Drop card here';
            }

            zoneEl.addEventListener('click', () => {
                if (selectedCardId) {
                    placeCard(selectedCardId, zone.id);
                }
            });

            zoneEl.addEventListener('dragover', (event) => {
                event.preventDefault();
                zoneEl.classList.add('drag-over');
            });

            zoneEl.addEventListener('dragleave', () => {
                zoneEl.classList.remove('drag-over');
            });

            zoneEl.addEventListener('drop', (event) => {
                event.preventDefault();
                zoneEl.classList.remove('drag-over');
                const droppedCardId = event.dataTransfer?.getData('text/plain') || selectedCardId;
                placeCard(droppedCardId, zone.id);
            });

            return zoneEl;
        }

        function validate() {
            const allPlaced = Object.values(placements).every(Boolean);
            if (!allPlaced) {
                result.textContent = 'Place both cards before checking.';
                result.classList.remove('success', 'error');
                result.classList.add('warning');
                return;
            }

            const isCorrect = Object.entries(correctPlacements).every(
                ([zoneId, expectedCardId]) => placements[zoneId] === expectedCardId
            );

            if (isCorrect) {
                result.textContent = 'Excellent! You identified both suspects correctly.';
                result.classList.remove('warning', 'error');
                result.classList.add('success');
            } else {
                result.textContent = 'Not quite. Check who is standing and who is sitting, then try again.';
                result.classList.remove('warning', 'success');
                result.classList.add('error');
            }
        }

        function reset() {
            placements.tim = null;
            placements.ronnie = null;
            selectedCardId = null;
            clearResult();
            render();
        }

        function render() {
            cards.innerHTML = '';
            zonesLayer.innerHTML = '';

            const unplacedCards = cardConfigs.filter((card) => !getZoneByCard(card.id));
            unplacedCards.forEach((card) => {
                cards.appendChild(createCardButton(card));
            });

            zoneConfigs.forEach((zone) => {
                zonesLayer.appendChild(createZone(zone));
            });
        }

        checkButton.addEventListener('click', validate);
        resetButton.addEventListener('click', reset);

        render();
        container.appendChild(board);
        container.appendChild(cards);
        container.appendChild(actions);
        container.appendChild(result);
        contentEl.appendChild(container);
    }

    return {
        renderSuspectsDragExercise
    };
})();
