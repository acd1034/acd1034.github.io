let input = document.getElementById("myinput");
let table = document.getElementById("mytable");
let tableData = [];
const caretClassName = "fa fa-sort";
const caretUpClassName = "fa fa-sort-up";
const caretDownClassName = "fa fa-sort-down";

$(function () {
  $.getJSON("data.json", function (data) {
    tableData = data;
    for (let item of tableData) {
      if (!item.journal && item.archivePrefix) {
        item.journal = item.archivePrefix;
      }
    }
    resetCaret();
    populateTable();
  });
});

function filterTable() {
  const words = input.value.toUpperCase().split(" ");
  let rows = table.getElementsByTagName("TR");
  for (let row of rows) {
    let cells = row.getElementsByTagName("TD");
    const allText = Array.from(cells)
      .map((cell) => cell.textContent.toUpperCase())
      .join(" ");

    if (words.every((word) => allText.includes(word))) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  }
}

function copyToClipboard(event) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(event.getAttribute("data-ref")).then(() => {
      event.innerHTML = `<i class="fa fa-clipboard-check"></i>`;
      setTimeout(
        () => (event.innerHTML = `<i class="fa fa-clipboard"></i>`),
        300
      );
    });
  }
}

function populateTable() {
  table.innerHTML = "";
  for (const data of tableData) {
    let row = table.insertRow(-1);
    let number = row.insertCell(0);
    number.innerHTML = data.url
      ? `<a href="${data.url}" target="_blank">${data.number}</a>`
      : data.number;

    let title = row.insertCell(1);
    title.innerHTML = data.title;

    const left = data.ja ? `<a href="${data.ja}" target="_blank">●</a> ` : "";
    const right = data.ja_old
      ? `<a href="${data.ja_old}" target="_blank">◆</a>`
      : "";
    let ja = row.insertCell(2);
    ja.innerHTML = left + right;

    let tag = row.insertCell(3);
    tag.innerHTML = data.tag;
  }
}

const sortBy = (field, reverse, primer) => {
  const key = primer
    ? function (x) {
        return primer(x[field]);
      }
    : function (x) {
        return x[field];
      };

  reverse = reverse ? -1 : 1;

  return function (a, b) {
    return (a = key(a)), (b = key(b)), reverse * ((a > b) - (b > a));
  };
};

function resetCaret() {
  let carets = document.getElementsByClassName("caret");
  for (let caret of carets) {
    caret.className = `caret ${caretClassName}`;
  }
}

function toggleCaret(event) {
  let element = event.target;
  let caret, field, reverse;
  if (element.tagName === "SPAN") {
    caret = element.getElementsByClassName("caret")[0];
    field = element.id;
  } else {
    caret = element;
    field = element.parentElement.id;
  }

  if (caret.className.includes(caretUpClassName)) {
    reverse = false;
    resetCaret();
    caret.className = `caret ${caretDownClassName}`;
  } else {
    reverse = true;
    resetCaret();
    caret.className = `caret ${caretUpClassName}`;
  }

  tableData.sort(sortBy(field, reverse));
}

input.addEventListener("keyup", function (event) {
  filterTable();
});

let tableColumns = document.getElementsByClassName("table-column");

for (let column of tableColumns) {
  column.addEventListener("click", function (event) {
    toggleCaret(event);
    populateTable();
    filterTable();
  });
}
