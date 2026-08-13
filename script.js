const ansMap = {
    'A': '1', 'B': '2', 'C': '3', 'D': '4',
    'a': '1', 'b': '2', 'c': '3', 'd': '4',
    '1': '1', '2': '2', '3': '3', '4': '4'
};

const THEME_PRESETS = {
    default: { bg: '#f3f4f6', card: '#ffffff', text: '#1f2937' },
    dark: { bg: '#111827', card: '#1f2937', text: '#f9fafb' },
    hc: { bg: '#000000', card: '#000000', text: '#ffff00' },
    eye: { bg: '#c7edcc', card: '#dcefd0', text: '#222222' }
};

const fileInput = document.getElementById('file-input');
const subjectSelect = document.getElementById('subject-select');
const questionCountInput = document.getElementById('question-count');
const startNumberInput = document.getElementById('start-number');
const endNumberInput = document.getElementById('end-number');
const examTimeInput = document.getElementById('exam-time');
const passRateInput = document.getElementById('pass-rate');
const directReviewCheckbox = document.getElementById('direct-review');
const startExamBtn = document.getElementById('start-exam-btn');
const errorMessage = document.getElementById('error-message');

const singleSubjectContainer = document.getElementById('single-subject-container');
const multiSubjectContainer = document.getElementById('multi-subject-container');
const multiSubjectList = document.getElementById('multi-subject-list');
const totalRatioEl = document.getElementById('total-ratio');
const evenDistributeBtn = document.getElementById('even-distribute-btn');

const settingExamTimeDiv = document.getElementById('setting-exam-time');
const settingPassRateDiv = document.getElementById('setting-pass-rate');
const settingDirectReviewDiv = document.getElementById('setting-direct-review');

const settingsPage = document.getElementById('settings-page');
const examPage = document.getElementById('exam-page');
const resultsPage = document.getElementById('results-page');
const reviewPage = document.getElementById('review-page');

const timerEl = document.getElementById('timer');
const questionTextEl = document.getElementById('question-text');
const optionsContainer = document.getElementById('options-container');
const practiceFeedback = document.getElementById('practice-feedback');
const practiceModeIndicator = document.getElementById('practice-mode-indicator');
const readModeIndicator = document.getElementById('read-mode-indicator');

const prevBtn = document.getElementById('prev-btn');
const confirmBtn = document.getElementById('confirm-btn');
const nextBtn = document.getElementById('next-btn');

const resultsSummaryEl = document.getElementById('results-summary');
const passFailMessageEl = document.getElementById('pass-fail-message');
const reviewQuestionsEl = document.getElementById('review-questions');
const reviewExamBtn = document.getElementById('review-exam-btn');
const restartBtn = document.getElementById('restart-btn');
const retryWrongBtn = document.getElementById('retry-wrong-btn');
const backToResultsBtn = document.getElementById('back-to-results-btn');

const statusOverviewBtn = document.getElementById('status-overview-btn');
const statusOverviewModal = document.getElementById('status-overview-modal');
const closeStatusOverviewBtn = document.getElementById('close-status-overview-btn');
const statusOverviewGrid = document.getElementById('status-overview-grid');
const confidenceSection = document.getElementById('confidence-section');
const confidenceUnsureBtn = document.getElementById('confidence-unsure-btn');
const confidenceConfidentBtn = document.getElementById('confidence-confident-btn');

const openThemeModalBtn = document.getElementById('open-theme-modal');
const themeModal = document.getElementById('theme-modal');
const closeThemeModalBtn = document.getElementById('close-theme-modal');
const themeBtns = document.querySelectorAll('.theme-btn');
const applyCustomBtn = document.getElementById('apply-custom-btn');
const resetThemeBtn = document.getElementById('reset-theme-btn');
const customBg = document.getElementById('custom-bg');
const customCard = document.getElementById('custom-card');
const customText = document.getElementById('custom-text');
const fontSizeSlider = document.getElementById('font-size-slider');
const fontSizeValueEl = document.getElementById('font-size-value');

let allQuestions = {};
let examQuestions = [];
let currentQuestionIndex = 0;
let userAnswers = {};
let confirmedAnswers = {};
let questionConfidence = {};
let examTimer;
let timeRemaining;
let timerInterval;
let isPracticeMode = false;
let isReadMode = false;
let subjectMode = 'single';
let lastWrongQuestions = [];
let currentFontScale = 100;

function getExplanation(question) {
    return question.解析 || question.詳解 || '此題無提供詳解。';
}

function formatCorrectAnswer(question, { markCorrectInputs = false } = {}) {
    if (question.題型 === '是非題') {
        const display = question.答案 === 'O' ? '是' : '非';
        if (markCorrectInputs) {
            const correctInput = document.querySelector(`input[data-answer='${question.答案}']`);
            if (correctInput) {
                correctInput.checked = true;
                correctInput.parentElement.classList.add('option-read-correct');
            }
        }
        return display;
    }

    const correctOptionIndices = question.答案.toString().split('.');
    return correctOptionIndices.map(rawIdx => {
        const idx = ansMap[rawIdx.trim()] || rawIdx.trim();
        if (markCorrectInputs) {
            const correctInput = document.querySelector(`input[data-answer='${idx}']`);
            if (correctInput) {
                correctInput.checked = true;
                correctInput.parentElement.classList.add('option-read-correct');
            }
        }
        return `選項${idx}: ${question[`選項${idx}`] || '無此選項資料'}`;
    }).join('<br>');
}

function formatUserAnswer(question, userAnswer) {
    if (question.題型 === '是非題') {
        return userAnswer === 'O' ? '是' : (userAnswer === 'X' ? '非' : '');
    }
    if (Array.isArray(userAnswer)) {
        return userAnswer.length > 0 ? userAnswer.slice().sort().join('、') : '';
    }
    return userAnswer ? userAnswer.toString() : '';
}

function buildFeedbackHtml({ icon, title, correctDisplay, explanation, borderStyleAttr }) {
    return `
        <p class="font-bold text-xl mb-3 flex items-center"><span class="text-2xl mr-2">${icon}</span> ${title}</p>
        <div class="mb-3 p-3 bg-card bg-opacity-80 rounded border ${borderStyleAttr.class}" ${borderStyleAttr.style}>
            <span class="font-semibold">正確答案：</span><br>${correctDisplay}
        </div>
        <div class="mt-2">
            <span class="font-semibold">詳解：</span><br>${explanation}
        </div>
    `;
}

function safeStorage(action, key, value) {
    try {
        if (action === 'get') return localStorage.getItem(key);
        if (action === 'set') return localStorage.setItem(key, value);
        if (action === 'remove') return localStorage.removeItem(key);
    } catch (e) {
        console.warn('localStorage 無法使用：', e);
        return null;
    }
}

function syncCustomColorInputs(themeName) {
    const preset = THEME_PRESETS[themeName];
    if (preset) {
        customBg.value = preset.bg;
        customCard.value = preset.card;
        customText.value = preset.text;
    }
}

function setTheme(themeName) {
    document.documentElement.removeAttribute('style');
    if (themeName === 'default') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', themeName);
    }
    safeStorage('set', 'quiz-theme', themeName);
    applyFontScale(currentFontScale);
}

function applyCustomTheme() {
    const bg = customBg.value;
    const card = customCard.value;
    const text = customText.value;

    const customVars = {
        '--theme-bg': bg,
        '--theme-card': card,
        '--theme-text': text,
        '--theme-border': text,
        '--theme-text-muted': text,
        '--theme-input-bg': bg,
        '--theme-card-alt': card,
    };

    document.documentElement.setAttribute('data-theme', 'custom');
    Object.entries(customVars).forEach(([prop, val]) => {
        document.documentElement.style.setProperty(prop, val);
    });

    safeStorage('set', 'quiz-theme', 'custom');
    safeStorage('set', 'quiz-custom-colors', JSON.stringify({ bg, card, text }));
    applyFontScale(currentFontScale);
}

function applyFontScale(percent) {
    currentFontScale = percent;
    document.documentElement.style.setProperty('--base-font-scale', percent / 100);
    fontSizeSlider.value = percent;
    fontSizeValueEl.textContent = percent;
    safeStorage('set', 'quiz-font-scale', percent);
}

fontSizeSlider.addEventListener('input', (e) => {
    applyFontScale(parseInt(e.target.value, 10));
});

syncCustomColorInputs('default');

const savedTheme = safeStorage('get', 'quiz-theme');
if (savedTheme === 'custom') {
    try {
        const raw = safeStorage('get', 'quiz-custom-colors');
        const colors = raw ? JSON.parse(raw) : null;
        if (colors) {
            customBg.value = colors.bg;
            customCard.value = colors.card;
            customText.value = colors.text;
            applyCustomTheme();
        }
    } catch (e) {
        console.warn('自訂主題顏色解析失敗，改用預設主題：', e);
        setTheme('default');
        syncCustomColorInputs('default');
    }
} else if (savedTheme) {
    setTheme(savedTheme);
    syncCustomColorInputs(savedTheme);
}

const savedFontScale = safeStorage('get', 'quiz-font-scale');
applyFontScale(savedFontScale ? parseInt(savedFontScale, 10) : 100);

openThemeModalBtn.addEventListener('click', () => themeModal.classList.remove('hidden'));
closeThemeModalBtn.addEventListener('click', () => themeModal.classList.add('hidden'));
themeModal.addEventListener('click', (e) => {
    if (e.target === themeModal) themeModal.classList.add('hidden');
});

themeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const themeName = e.target.dataset.setTheme;
        setTheme(themeName);
        syncCustomColorInputs(themeName);
    });
});

applyCustomBtn.addEventListener('click', applyCustomTheme);
resetThemeBtn.addEventListener('click', () => {
    setTheme('default');
    syncCustomColorInputs('default');
    safeStorage('remove', 'quiz-custom-colors');
});

document.querySelectorAll('input[name="subject-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        subjectMode = e.target.value;
        if (subjectMode === 'single') {
            singleSubjectContainer.classList.remove('hidden');
            multiSubjectContainer.classList.add('hidden');
            document.querySelector('input[name="exam-scope"][value="range"]').disabled = false;
        } else {
            singleSubjectContainer.classList.add('hidden');
            multiSubjectContainer.classList.remove('hidden');
            const rangeRadio = document.querySelector('input[name="exam-scope"][value="range"]');
            rangeRadio.disabled = true;
            if (rangeRadio.checked) {
                document.querySelector('input[name="exam-scope"][value="random"]').checked = true;
                document.querySelector('input[name="exam-scope"][value="random"]').dispatchEvent(new Event('change'));
            }
        }
        updateFilterOptions();
    });
});

document.querySelectorAll('input[name="test-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const mode = e.target.value;
        if (mode === 'read') {
            settingExamTimeDiv.classList.add('hidden');
            settingPassRateDiv.classList.add('hidden');
            settingDirectReviewDiv.classList.add('hidden');
        } else {
            settingExamTimeDiv.classList.remove('hidden');
            settingPassRateDiv.classList.remove('hidden');
            settingDirectReviewDiv.classList.remove('hidden');
        }
    });
});

function updateFilterOptions() {
    let selectedSubjects = [];
    if (subjectMode === 'single') {
        if (subjectSelect.value) selectedSubjects.push(subjectSelect.value);
    } else {
        document.querySelectorAll('.multi-subject-checkbox:checked').forEach(cb => selectedSubjects.push(cb.value));
    }

    const type = document.querySelector('input[name="question-type"]:checked').value;
    const filterSection = document.getElementById('answer-filter-section');
    const tfGroup = document.getElementById('filter-tf-group');
    const mcGroup = document.getElementById('filter-mc-group');

    if (selectedSubjects.length === 0 || type === '混合') {
        filterSection.classList.add('hidden');
        return;
    }

    filterSection.classList.remove('hidden');

    if (type === '是非題') {
        tfGroup.classList.remove('hidden');
        mcGroup.classList.add('hidden');
    } else if (type === '選擇題') {
        tfGroup.classList.add('hidden');
        mcGroup.classList.remove('hidden');

        mcGroup.innerHTML = '';
        let allPossibleAnswers = new Set();

        selectedSubjects.forEach(subj => {
            if (allQuestions[subj] && allQuestions[subj]['選擇題']) {
                allQuestions[subj]['選擇題'].forEach(q => {
                    if (q.答案) allPossibleAnswers.add(q.答案.toString());
                });
            }
        });

        const uniqueAnswers = [...allPossibleAnswers].sort();

        if (uniqueAnswers.length === 0) {
            mcGroup.innerHTML = '<span class="text-sm theme-text-muted">無可用的答案選項</span>';
            return;
        }

        uniqueAnswers.forEach(ans => {
            const label = document.createElement('label');
            label.className = 'flex items-center cursor-pointer px-4 py-2 rounded-full theme-border border shadow-sm bg-card hover:opacity-80 transition duration-200';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'form-checkbox text-blue-600 w-4 h-4 rounded filter-mc-checkbox';
            input.value = ans;

            const span = document.createElement('span');
            span.className = 'ml-2 text-sm font-medium';
            span.textContent = `答案: ${ans}`;

            label.appendChild(input);
            label.appendChild(span);
            mcGroup.appendChild(label);
        });
    }
}

document.querySelectorAll('input[name="question-type"]').forEach(radio => {
    radio.addEventListener('change', updateFilterOptions);
});
subjectSelect.addEventListener('change', updateFilterOptions);

fileInput.addEventListener('change', (event) => {
    allQuestions = {};
    const files = event.target.files;
    const subjects = new Set();
    let filesProcessed = 0;

    subjectSelect.innerHTML = '<option value="">正在載入...</option>';

    Array.from(files).forEach(file => {
        const fileName = file.name;
        const subjectMatch = fileName.match(/【(.*?)】/);
        let subject = subjectMatch ? subjectMatch[1] : fileName.replace(/\.[^/.]+$/, "");

        if (!allQuestions[subject]) {
            allQuestions[subject] = { '是非題': [], '選擇題': [] };
        }

        if (fileName.endsWith('.xlsx')) {
            const reader = new FileReader();
            reader.onload = function (e) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                workbook.SheetNames.forEach(sheetName => {
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);

                    if (sheetName.includes('是非題')) {
                        allQuestions[subject]['是非題'] = allQuestions[subject]['是非題'].concat(jsonData.filter(q => q.題型 && q.答案 && q.題目));
                    } else if (sheetName.includes('選擇題')) {
                        allQuestions[subject]['選擇題'] = allQuestions[subject]['選擇題'].concat(jsonData.filter(q => q.題型 && q.答案 && q.題目));
                    }
                });

                subjects.add(subject);
                filesProcessed++;
                if (filesProcessed === files.length) { renderSubjects(subjects); }
            };
            reader.onerror = function () {
                errorMessage.textContent = `檔案解析錯誤: ${file.name}`;
                errorMessage.classList.remove('hidden');
                filesProcessed++;
            };
            reader.readAsArrayBuffer(file);

        } else if (fileName.endsWith('.csv')) {
            Papa.parse(file, {
                header: true,
                complete: function (results) {
                    results.data.forEach(q => {
                        if (q.題型 && q.答案 && q.題目) {
                            const qType = q.題型.includes('是非') ? '是非題' : '選擇題';
                            allQuestions[subject][qType].push(q);
                        }
                    });

                    subjects.add(subject);
                    filesProcessed++;
                    if (filesProcessed === files.length) { renderSubjects(subjects); }
                },
                error: function () {
                    errorMessage.textContent = `檔案解析錯誤: ${file.name}`;
                    errorMessage.classList.remove('hidden');
                    filesProcessed++;
                }
            });
        }
    });
});

function renderSubjects(subjects) {
    subjectSelect.innerHTML = '<option value="">請選擇科目</option>';
    multiSubjectList.innerHTML = '';

    subjects.forEach(subject => {
        const option = document.createElement('option');
        option.value = subject;
        option.textContent = subject;
        subjectSelect.appendChild(option);

        const div = document.createElement('div');
        div.className = 'flex items-center justify-between theme-bg-alt p-2 theme-border border rounded transition';
        div.innerHTML = `
            <label class="flex items-center cursor-pointer flex-1 overflow-hidden">
                <input type="checkbox" class="form-checkbox text-blue-600 w-4 h-4 rounded multi-subject-checkbox" value="${subject}">
                <span class="ml-2 truncate" title="${subject}">${subject}</span>
            </label>
            <div class="flex items-center w-28 ml-2 hidden ratio-container">
                <input type="number" class="w-16 theme-border border rounded p-1 text-right text-sm multi-subject-ratio focus:ring-blue-500 focus:outline-none theme-bg-input" style="color: var(--theme-text)" min="0" max="100" value="0">
                <span class="ml-1 text-sm theme-text-muted">%</span>
            </div>
        `;
        multiSubjectList.appendChild(div);

        const checkbox = div.querySelector('.multi-subject-checkbox');
        const ratioContainer = div.querySelector('.ratio-container');
        const ratioInput = div.querySelector('.multi-subject-ratio');

        checkbox.addEventListener('change', () => {
            ratioContainer.classList.toggle('hidden', !checkbox.checked);
            if (!checkbox.checked) ratioInput.value = 0;
            calculateTotalRatio();
            updateFilterOptions();
        });

        ratioInput.addEventListener('input', calculateTotalRatio);
    });
    errorMessage.classList.add('hidden');
    updateFilterOptions();
}

function calculateTotalRatio() {
    let total = 0;
    document.querySelectorAll('.multi-subject-ratio').forEach(input => {
        if (!input.closest('div').classList.contains('hidden')) {
            total += parseFloat(input.value) || 0;
        }
    });
    total = Math.round(total * 10) / 10;
    totalRatioEl.textContent = total;
    if (total === 100) {
        totalRatioEl.style.color = '#10B981';
    } else {
        totalRatioEl.style.color = '#EF4444';
    }
}

evenDistributeBtn.addEventListener('click', () => {
    const checkedBoxes = Array.from(document.querySelectorAll('.multi-subject-checkbox:checked'));
    if (checkedBoxes.length === 0) return;

    const avg = 100 / checkedBoxes.length;
    let currentSum = 0;
    const inputs = checkedBoxes.map(cb => cb.closest('div').querySelector('.multi-subject-ratio'));

    inputs.forEach((input, index) => {
        if (index === inputs.length - 1) {
            let remainder = (100 - currentSum).toFixed(1);
            if (remainder.endsWith('.0')) remainder = parseInt(remainder);
            input.value = remainder;
        } else {
            let val = Math.floor(avg);
            input.value = val;
            currentSum += val;
        }
    });
    calculateTotalRatio();
});

document.querySelectorAll('input[name="exam-scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
        questionCountInput.disabled = radio.value !== 'random';
        startNumberInput.disabled = radio.value !== 'range';
        endNumberInput.disabled = radio.value !== 'range';
    });
});

function getFilteredPool(subject, type) {
    let pool = [];
    if (type === '混合') {
        pool = allQuestions[subject]['是非題'].concat(allQuestions[subject]['選擇題']);
    } else {
        pool = allQuestions[subject][type] || [];
    }

    pool = pool.map(q => ({ ...q, _source: subject }));

    if (type === '是非題') {
        const checkO = document.getElementById('filter-tf-o').checked;
        const checkX = document.getElementById('filter-tf-x').checked;
        if (checkO || checkX) {
            pool = pool.filter(q => (checkO && q.答案 === 'O') || (checkX && q.答案 === 'X'));
        }
    } else if (type === '選擇題') {
        const checkedBoxes = Array.from(document.querySelectorAll('.filter-mc-checkbox:checked')).map(cb => cb.value);
        if (checkedBoxes.length > 0) {
            pool = pool.filter(q => checkedBoxes.includes(q.答案.toString()));
        }
    }
    return pool;
}

startExamBtn.addEventListener('click', () => {
    const testMode = document.querySelector('input[name="test-mode"]:checked').value;
    isPracticeMode = testMode === 'practice';
    isReadMode = testMode === 'read';

    const questionType = document.querySelector('input[name="question-type"]:checked').value;
    const examScope = document.querySelector('input[name="exam-scope"]:checked').value;
    const examTime = parseInt(examTimeInput.value, 10);
    const passRate = parseInt(passRateInput.value, 10);
    const countInputVal = parseInt(questionCountInput.value, 10);

    if (!isReadMode && (isNaN(passRate) || passRate < 0 || passRate > 100)) {
        showError('通過率必須是介於 0 到 100 的數字。');
        return;
    }

    examQuestions = [];

    if (subjectMode === 'single') {
        const subject = subjectSelect.value;
        if (!subject) {
            showError('請選擇一個科目。');
            return;
        }

        let questionPool = getFilteredPool(subject, questionType);

        if (questionPool.length === 0) {
            showError('所選科目或題型沒有可用的題目 (或被篩選條件過濾完)。');
            return;
        }

        if (examScope === 'all') {
            examQuestions = questionPool;
        } else if (examScope === 'random') {
            if (isNaN(countInputVal) || countInputVal <= 0 || countInputVal > questionPool.length) {
                showError(`請輸入介於 1 到 ${questionPool.length} 的有效題數。(篩選後題庫數為 ${questionPool.length})`);
                return;
            }
            examQuestions = getRandomQuestions(questionPool, countInputVal);
        } else if (examScope === 'range') {
            const start = parseInt(startNumberInput.value, 10);
            const end = parseInt(endNumberInput.value, 10);
            if (isNaN(start) || isNaN(end) || start <= 0 || end <= 0 || start > end) {
                showError('請輸入有效的起始與結束題號。');
                return;
            }
            examQuestions = questionPool.filter(q => parseInt(q.題號) >= start && parseInt(q.題號) <= end);
        }

        document.getElementById('exam-title').textContent = `${subject} - ${questionType}`;

    } else {
        const checkedSubjects = Array.from(document.querySelectorAll('.multi-subject-checkbox:checked'));
        if (checkedSubjects.length === 0) {
            showError('請至少勾選一個科目。');
            return;
        }

        if (examScope === 'random') {
            let totalPercent = 0;
            let subjectRatios = [];
            checkedSubjects.forEach(cb => {
                const ratio = parseFloat(cb.closest('div').querySelector('.multi-subject-ratio').value) || 0;
                totalPercent += ratio;
                subjectRatios.push({ subject: cb.value, ratio: ratio });
            });

            if (Math.abs(totalPercent - 100) > 0.1) {
                showError('多科目合併測驗時，總比例必須剛好為 100%。');
                return;
            }

            if (isNaN(countInputVal) || countInputVal <= 0) {
                showError('請輸入有效的考試題數。');
                return;
            }

            let subjectPools = {};
            let totalAvailable = 0;
            subjectRatios.forEach(sr => {
                subjectPools[sr.subject] = getFilteredPool(sr.subject, questionType);
                totalAvailable += subjectPools[sr.subject].length;
            });

            if (totalAvailable < countInputVal) {
                showError(`總題庫數量不足 (${totalAvailable} 題) ，無法產生 ${countInputVal} 題。`);
                return;
            }

            let allocations = [];
            let currentAllocatedSum = 0;

            subjectRatios.forEach(sr => {
                const exact = countInputVal * (sr.ratio / 100);
                const integerPart = Math.floor(exact);
                const fractionPart = exact - integerPart;
                allocations.push({
                    subject: sr.subject,
                    intPart: integerPart,
                    fraction: fractionPart,
                    finalCount: integerPart,
                    pool: subjectPools[sr.subject]
                });
                currentAllocatedSum += integerPart;
            });

            let remainder = countInputVal - currentAllocatedSum;
            allocations.sort((a, b) => b.fraction - a.fraction);
            for (let i = 0; i < remainder; i++) {
                allocations[i].finalCount++;
            }

            let shortfalls = [];
            allocations.forEach(alloc => {
                if (alloc.finalCount > alloc.pool.length) {
                    shortfalls.push(`「${alloc.subject}」需 ${alloc.finalCount} 題, 但篩選後僅剩 ${alloc.pool.length} 題符合條件`);
                } else if (alloc.finalCount > 0) {
                    const picked = getRandomQuestions(alloc.pool, alloc.finalCount);
                    examQuestions = examQuestions.concat(picked);
                }
            });

            if (shortfalls.length > 0) {
                showError(`部分科目符合條件的題數不足以滿足設定的比例：\n${shortfalls.join('\n')}`);
                return;
            }
        } else if (examScope === 'all') {
            checkedSubjects.forEach(cb => {
                let pool = getFilteredPool(cb.value, questionType);
                examQuestions = examQuestions.concat(pool);
            });
        }

        document.getElementById('exam-title').textContent = `綜合測驗 - ${questionType}`;
    }

    if (!isReadMode || examScope === 'random') {
        examQuestions = shuffleArray(examQuestions);
    }

    if (examQuestions.length === 0) {
        showError('根據您的篩選條件，沒有符合的題目。');
        return;
    }

    userAnswers = {};
    confirmedAnswers = {};
    questionConfidence = {};
    currentQuestionIndex = 0;

    settingsPage.classList.add('hidden');
    examPage.classList.remove('hidden');

    practiceModeIndicator.classList.toggle('hidden', !isPracticeMode);
    readModeIndicator.classList.toggle('hidden', !isReadMode);
    confidenceSection.classList.toggle('hidden', isReadMode);
    statusOverviewBtn.classList.toggle('hidden', isReadMode);

    if (isReadMode) {
        timerEl.classList.add('hidden');
    } else {
        timerEl.classList.remove('hidden');
        if (examTime > 0) {
            timeRemaining = examTime * 60;
            timerInterval = setInterval(updateTimer, 1000);
        } else {
            timerEl.textContent = '無時間限制';
        }
    }

    displayQuestion();
});

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getRandomQuestions(pool, count) {
    const shuffledPool = shuffleArray([...pool]);
    return shuffledPool.slice(0, count);
}

function updateTimer() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (timeRemaining <= 60) { timerEl.style.color = '#EF4444'; timerEl.style.fontWeight = 'bold'; }
    else { timerEl.style.color = ''; timerEl.style.fontWeight = ''; }

    if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        endExam();
    }
    timeRemaining--;
}

function displayQuestion() {
    if (examQuestions.length === 0) return;

    const question = examQuestions[currentQuestionIndex];
    const questionNumber = currentQuestionIndex + 1;

    const sourceTag = question._source ? `<span class="inline-block px-2 py-1 rounded mb-2 mr-2 border text-xs" style="background-color: var(--theme-info-bg); color: var(--theme-info-text); border-color: var(--theme-info-border);">來源：${question._source}</span>` : '';

    questionTextEl.innerHTML = `${sourceTag}<br><span class="font-bold mr-2 theme-text-muted">${questionNumber}/${examQuestions.length}</span> ${question.題目}`;
    optionsContainer.innerHTML = '';
    practiceFeedback.classList.add('hidden');

    const isMultiSelect = question.題型 === '選擇題' && question.答案.toString().includes('.');
    const inputType = isMultiSelect ? 'checkbox' : 'radio';

    if (question.題型 === '是非題') {
        createOptionElement('O', '是', 'O', 'radio');
        createOptionElement('X', '非', 'X', 'radio');
    } else {
        for (let i = 1; i <= 4; i++) {
            const optionKey = `選項${i}`;
            if (question[optionKey]) {
                createOptionElement(i, question[optionKey], i, inputType);
            }
        }
    }

    if (userAnswers[currentQuestionIndex]) {
        const currentAnswers = Array.isArray(userAnswers[currentQuestionIndex]) ? userAnswers[currentQuestionIndex] : [userAnswers[currentQuestionIndex]];
        currentAnswers.forEach(answer => {
            const input = document.querySelector(`input[data-answer='${answer}']`);
            if (input) { input.checked = true; }
        });
    }

    if (!isReadMode) {
        updateConfidenceButtonsUI();
    }

    if (isReadMode) {
        disableOptions();
        showReadFeedback();
        confirmBtn.classList.add('hidden');
        nextBtn.classList.remove('hidden');
        prevBtn.classList.toggle('hidden', currentQuestionIndex === 0);
        nextBtn.textContent = (currentQuestionIndex === examQuestions.length - 1) ? '結束讀題' : '下一題 >';
    }
    else if (isPracticeMode) {
        if (confirmedAnswers[currentQuestionIndex]) {
            showPracticeFeedback();
            disableOptions();
            confirmBtn.classList.add('hidden');
            nextBtn.classList.remove('hidden');
            prevBtn.classList.toggle('hidden', currentQuestionIndex === 0);
        } else {
            confirmBtn.classList.remove('hidden');
            nextBtn.classList.add('hidden');
            prevBtn.classList.toggle('hidden', currentQuestionIndex === 0);
        }
        nextBtn.textContent = (currentQuestionIndex === examQuestions.length - 1) ? '結束測驗' : '下一題 >';
    }
    else {
        confirmBtn.classList.add('hidden');
        nextBtn.classList.remove('hidden');
        prevBtn.classList.toggle('hidden', currentQuestionIndex === 0);
        nextBtn.textContent = (currentQuestionIndex === examQuestions.length - 1) ? '結束測驗' : '下一題 >';
    }
}

function createOptionElement(value, text, dataValue, inputType) {
    const label = document.createElement('label');
    label.className = 'flex items-center space-x-3 p-4 rounded-lg theme-border border cursor-pointer transition duration-200 ease-in-out bg-card hover:opacity-80';

    const input = document.createElement('input');
    input.type = inputType;
    input.className = `text-blue-600 focus:ring-blue-500 w-5 h-5 ${inputType === 'radio' ? 'form-radio' : 'form-checkbox rounded'}`;
    input.name = `question-${currentQuestionIndex}`;
    input.value = dataValue;
    input.setAttribute('data-answer', dataValue);

    input.addEventListener('change', () => {
        const question = examQuestions[currentQuestionIndex];
        const isMultiSelect = question.題型 === '選擇題' && question.答案.toString().includes('.');

        if (isMultiSelect) {
            const checkedInputs = Array.from(optionsContainer.querySelectorAll('input:checked'));
            userAnswers[currentQuestionIndex] = checkedInputs.map(inp => inp.value);
        } else {
            userAnswers[currentQuestionIndex] = input.value;
        }
    });

    const span = document.createElement('span');
    span.className = 'text-base leading-relaxed';
    span.textContent = `${value}. ${text}`;

    label.appendChild(input);
    label.appendChild(span);
    optionsContainer.appendChild(label);
}

function applyFeedbackStyle(el, type) {
    el.classList.remove('hidden', 'feedback-success', 'feedback-error', 'feedback-info');
    el.classList.add('feedback-box', `feedback-${type}`);
    el.style.borderWidth = '';
    el.style.backgroundColor = '';
    el.style.borderColor = '';
    el.style.color = '';
}

function showReadFeedback() {
    const q = examQuestions[currentQuestionIndex];
    const explanation = getExplanation(q);

    applyFeedbackStyle(practiceFeedback, 'info');

    const correctDisplay = formatCorrectAnswer(q, { markCorrectInputs: true });

    practiceFeedback.innerHTML = buildFeedbackHtml({
        icon: '💡',
        title: '正確答案與詳解',
        correctDisplay,
        explanation,
        borderStyleAttr: { class: 'theme-border', style: '' }
    });
}

confirmBtn.addEventListener('click', () => {
    const answer = userAnswers[currentQuestionIndex];
    if (!answer || (Array.isArray(answer) && answer.length === 0)) {
        showError('請先選擇答案再確認！');
        setTimeout(() => { errorMessage.classList.add('hidden'); }, 2000);
        return;
    }

    confirmedAnswers[currentQuestionIndex] = true;
    showPracticeFeedback();
    disableOptions();

    confirmBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');
});

function showPracticeFeedback() {
    const q = examQuestions[currentQuestionIndex];
    const isCorrect = isAnswerCorrect(q, userAnswers[currentQuestionIndex]);
    const explanation = getExplanation(q);
    const correctDisplay = formatCorrectAnswer(q);

    if (isCorrect) {
        applyFeedbackStyle(practiceFeedback, 'success');
        practiceFeedback.innerHTML = buildFeedbackHtml({
            icon: '✅',
            title: '答對了！',
            correctDisplay,
            explanation,
            borderStyleAttr: { class: '', style: `style="border-color: var(--theme-success-border)"` }
        });
    } else {
        applyFeedbackStyle(practiceFeedback, 'error');
        practiceFeedback.innerHTML = buildFeedbackHtml({
            icon: '❌',
            title: '答錯了！',
            correctDisplay,
            explanation,
            borderStyleAttr: { class: '', style: `style="border-color: var(--theme-error-border)"` }
        });
    }
}

function disableOptions() {
    document.querySelectorAll('#options-container input').forEach(input => {
        input.disabled = true;
    });
    document.querySelectorAll('#options-container label').forEach(label => {
        label.classList.remove('cursor-pointer', 'hover:opacity-80');
        label.classList.add('cursor-not-allowed');
        if (!label.classList.contains('option-read-correct')) {
            label.classList.add('opacity-60');
        }
    });
}

nextBtn.addEventListener('click', () => {
    if (nextBtn.textContent === '結束測驗' || nextBtn.textContent === '結束讀題') {
        endExam();
    } else {
        currentQuestionIndex++;
        displayQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});

prevBtn.addEventListener('click', () => {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        displayQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});

function endExam() {
    clearInterval(timerInterval);
    examPage.classList.add('hidden');

    if (isReadMode) {
        resultsSummaryEl.textContent = `您已瀏覽完畢共 ${examQuestions.length} 題。`;
        passFailMessageEl.textContent = '';
        passFailMessageEl.className = 'text-3xl font-bold';
        reviewExamBtn.classList.add('hidden');
        retryWrongBtn.classList.add('hidden');
        lastWrongQuestions = [];
        resultsPage.classList.remove('hidden');
        return;
    }

    let correctCount = 0;
    lastWrongQuestions = [];
    examQuestions.forEach((q, index) => {
        if (isAnswerCorrect(q, userAnswers[index])) {
            correctCount++;
        } else {
            lastWrongQuestions.push(q);
        }
    });

    const totalQuestions = examQuestions.length;
    const accuracy = (correctCount / totalQuestions) * 100;
    const passRate = parseInt(passRateInput.value, 10);

    resultsSummaryEl.textContent = `您答對了 ${correctCount} 題，總共 ${totalQuestions} 題。正確率為 ${accuracy.toFixed(2)}%。`;

    if (accuracy >= passRate) {
        passFailMessageEl.textContent = '恭喜您，通過測驗！';
        passFailMessageEl.style.color = '#10B981';
    } else {
        passFailMessageEl.textContent = '很遺憾，您未通過測驗。';
        passFailMessageEl.style.color = '#EF4444';
    }

    reviewExamBtn.classList.remove('hidden');
    retryWrongBtn.classList.toggle('hidden', lastWrongQuestions.length === 0);

    if (directReviewCheckbox.checked) {
        reviewPage.classList.remove('hidden');
        displayReviewQuestions();
    } else {
        resultsPage.classList.remove('hidden');
    }
}

reviewExamBtn.addEventListener('click', () => {
    resultsPage.classList.add('hidden');
    reviewPage.classList.remove('hidden');
    displayReviewQuestions();
});

function displayReviewQuestions() {
    reviewQuestionsEl.innerHTML = '';
    examQuestions.forEach((q, index) => {
        const reviewItem = document.createElement('div');
        reviewItem.className = 'bg-card p-6 rounded-xl theme-border border shadow-sm space-y-4';

        const questionText = document.createElement('p');
        questionText.className = 'text-lg font-semibold';
        questionText.innerHTML = `<span class="font-bold mr-2 theme-text-muted">${index + 1}.</span> ${q.題目}`;

        const answerStatus = document.createElement('div');
        const userAnswer = userAnswers[index];
        const isCorrect = isAnswerCorrect(q, userAnswer);

        answerStatus.className = 'font-bold text-lg mb-2';
        answerStatus.textContent = isCorrect ? '✅ 您的答案：正確' : `❌ 您的答案：錯誤`;
        answerStatus.style.color = isCorrect ? '#10B981' : '#EF4444';

        const flexContainer = document.createElement('div');
        flexContainer.className = 'flex flex-col md:flex-row md:space-x-8 space-y-4 md:space-y-0 p-4 theme-bg-alt rounded-lg theme-border border';

        const userAnswerCol = document.createElement('div');
        userAnswerCol.className = 'flex-1';
        const userDisplay = formatUserAnswer(q, userAnswer) || '未作答';
        userAnswerCol.innerHTML = `<span class="font-medium theme-text-muted">您的選擇 (內部編號)：</span><br><span class="font-bold text-lg">${userDisplay}</span>`;

        const correctAnswerCol = document.createElement('div');
        correctAnswerCol.className = 'flex-1';
        const correctDisplay = formatCorrectAnswer(q);
        correctAnswerCol.innerHTML = `<span class="font-medium theme-text-muted">正確答案：</span><br><span class="font-bold text-lg">${correctDisplay}</span>`;

        flexContainer.appendChild(userAnswerCol);
        flexContainer.appendChild(correctAnswerCol);

        reviewItem.appendChild(questionText);
        reviewItem.appendChild(answerStatus);
        reviewItem.appendChild(flexContainer);

        const explanation = getExplanation(q);
        const explanationBlock = document.createElement('div');
        explanationBlock.className = 'mt-4 p-4 rounded-lg border';
        explanationBlock.style.backgroundColor = 'var(--theme-info-bg)';
        explanationBlock.style.color = 'var(--theme-info-text)';
        explanationBlock.style.borderColor = 'var(--theme-info-border)';
        explanationBlock.innerHTML = `<span class="font-semibold">💡 詳解：</span><br>${explanation}`;
        reviewItem.appendChild(explanationBlock);

        reviewQuestionsEl.appendChild(reviewItem);
    });
}

function isAnswerCorrect(question, userAnswer) {
    if (question.題型 === '是非題') {
        return userAnswer === question.答案;
    } else {
        const userSelected = Array.isArray(userAnswer) ? userAnswer.sort() : (userAnswer ? [userAnswer] : []);
        const correctAnswers = question.答案.toString().split('.')
            .map(val => ansMap[val.trim()] || val.trim())
            .sort();

        if (correctAnswers.length !== userSelected.length) return false;
        return correctAnswers.every((val, index) => val === userSelected[index]);
    }
}

backToResultsBtn.addEventListener('click', () => {
    reviewPage.classList.add('hidden');
    resultsPage.classList.remove('hidden');
});

restartBtn.addEventListener('click', () => {
    resultsPage.classList.add('hidden');
    settingsPage.classList.remove('hidden');
});

retryWrongBtn.addEventListener('click', () => {
    if (lastWrongQuestions.length === 0) return;

    examQuestions = shuffleArray([...lastWrongQuestions]);
    userAnswers = {};
    confirmedAnswers = {};
    questionConfidence = {};
    currentQuestionIndex = 0;
    lastWrongQuestions = [];

    resultsPage.classList.add('hidden');
    reviewPage.classList.add('hidden');
    examPage.classList.remove('hidden');

    const titleEl = document.getElementById('exam-title');
    const baseTitle = titleEl.textContent.replace(/（錯題重考）$/, '');
    titleEl.textContent = `${baseTitle}（錯題重考）`;

    practiceModeIndicator.classList.toggle('hidden', !isPracticeMode);
    readModeIndicator.classList.add('hidden');
    confidenceSection.classList.remove('hidden');
    statusOverviewBtn.classList.remove('hidden');

    clearInterval(timerInterval);
    const examTime = parseInt(examTimeInput.value, 10);
    timerEl.classList.remove('hidden');
    if (examTime > 0) {
        timeRemaining = examTime * 60;
        timerInterval = setInterval(updateTimer, 1000);
    } else {
        timerEl.textContent = '無時間限制';
    }

    displayQuestion();
});

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

confidenceUnsureBtn.addEventListener('click', () => {
    toggleConfidence('unsure');
});
confidenceConfidentBtn.addEventListener('click', () => {
    toggleConfidence('confident');
});

function toggleConfidence(type) {
    if (questionConfidence[currentQuestionIndex] === type) {
        delete questionConfidence[currentQuestionIndex];
    } else {
        questionConfidence[currentQuestionIndex] = type;
    }
    updateConfidenceButtonsUI();
}

function updateConfidenceButtonsUI() {
    confidenceSection.classList.toggle('hidden', isReadMode);
    const current = questionConfidence[currentQuestionIndex];

    setConfidenceBtnState(confidenceUnsureBtn, current === 'unsure', 'unsure');
    setConfidenceBtnState(confidenceConfidentBtn, current === 'confident', 'confident');
}

function setConfidenceBtnState(btn, isActive, activeType) {
    btn.classList.remove(
        'confidence-btn-active-unsure',
        'confidence-btn-active-confident',
        'confidence-btn-inactive'
    );
    btn.classList.add(isActive ? `confidence-btn-active-${activeType}` : 'confidence-btn-inactive');
}

statusOverviewBtn.addEventListener('click', () => {
    renderStatusOverview();
    statusOverviewModal.classList.remove('hidden');
});

closeStatusOverviewBtn.addEventListener('click', () => {
    statusOverviewModal.classList.add('hidden');
});

statusOverviewModal.addEventListener('click', (e) => {
    if (e.target === statusOverviewModal) {
        statusOverviewModal.classList.add('hidden');
    }
});

function renderStatusOverview() {
    statusOverviewGrid.innerHTML = '';
    examQuestions.forEach((q, index) => {
        const ans = userAnswers[index];
        const answered = ans !== undefined && ans !== null && !(Array.isArray(ans) && ans.length === 0);
        const answerDisplay = formatUserAnswer(q, ans);

        const confidence = questionConfidence[index];
        const confidenceIcon = confidence === 'unsure' ? '❓' : (confidence === 'confident' ? '✅' : '');
        const isCurrent = index === currentQuestionIndex;

        const item = document.createElement('div');
        const statusClass = answered ? 'overview-item-answered' : 'overview-item-unanswered';
        item.className = `p-3 rounded-lg border text-sm transition-colors ${statusClass} ${isCurrent ? 'ring-2 ring-blue-400' : ''}`;

        item.innerHTML = `
            <div class="font-bold flex items-center justify-between">
                <span>第 ${index + 1} 題</span>
                <span>${confidenceIcon}</span>
            </div>
            <div class="mt-1 opacity-80">${answered ? `選擇：${answerDisplay}` : '未作答'}</div>
        `;
        statusOverviewGrid.appendChild(item);
    });
}
