import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
const PAGE_W = 210;
const PAGE_H = 297;
const LAYOUT = {
    page: { width: PAGE_W, height: PAGE_H },
    frame: { x: 5.3, y: 5.3, w: 199.4, h: 285.8, right: 204.7, bottom: 291.1 },
    header: {
        top: 5.3,
        bottom: 29.6,
        logo: { x: 7.0, y: 8.0, maxWidth: 25.5, maxHeight: 17.5 },
        companyName: { x: 39.0, y: 14.5, maxWidth: 112 },
        address: { x: 39.0, y: 19.6, maxWidth: 113, lineHeight: 3.5 },
        taxBlock: { x: 154.8, right: 202.8, gstY: 19.0, panY: 25.5 },
    },
    billTo: {
        top: 29.6,
        bottom: 66.4,
        dividerX: 154.8,
        leftPadding: 8.0,
        contentX: 30.6,
        billToLabelY: 36.8,
        customerNameY: 37.0,
        addressY: 43.8,
        mobileY: 57.4,
        gstY: 62.6,
    },
    invoiceMeta: {
        titleTop: 29.6,
        titleBottom: 38.0,
        x: 154.8,
        right: 204.7,
        valueRight: 202.2,
        rows: {
            number: 43.5,
            date: 50.1,
            placeOfSupply: 57.0,
        },
    },
    itemTable: {
        top: 66.4,
        headerBottom: 72.8,
        finalBottom: 175.4,
        continuationBottom: 291.1,
        columns: {
            item: [5.3, 45.2],
            hsn: [45.2, 61.9],
            qty: [61.9, 82.5],
            rate: [82.5, 103.4],
            discount: [103.4, 124.3],
            amount: [124.3, 149.1],
            taxA: [149.1, 165.6],
            taxB: [165.6, 182.3],
            total: [182.3, 204.7],
        },
        serialX: 7.0,
        itemTextX: 14.7,
    },
    quantityStrip: {
        top: 175.4,
        bottom: 183.8,
        labelRight: 61.0,
        valueX: 63.0,
        baselineY: 181.3,
    },
    summary: {
        top: 183.8,
        bottom: 248.3,
        dividerX: 137.2,
        words: { x: 7.8, top: 187.0, bottom: 196.3, maxWidth: 126 },
        taxTable: { x: 7.8, right: 136.2, top: 196.5, bottom: 216.4 },
        taxWords: { top: 216.4, bottom: 223.5, baselineY: 220.8 },
        bank: { top: 223.5, bottom: 248.3, padding: 2.5 },
        totals: { x: 137.2, right: 204.7, labelRight: 166.5, valueRight: 201.8, topY: 192.4 },
    },
    footer: {
        top: 248.3,
        bottom: 291.1,
        termsRight: 100.8,
        receiverRight: 137.2,
        authorizedRight: 180.0,
        qrRight: 204.7,
        receiverLineY: 285.7,
        authorizedLineY: 285.7,
        captionY: 289.9,
    },
    outsideFooter: { x: 6.1, y: 295.1 },
};
const COLORS = {
    text: [12, 12, 12],
    border: [35, 35, 35],
    white: [255, 255, 255],
};
const roundCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const sanitizeText = (value, fallback = '') => {
    const text = String(value ?? '')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text || fallback;
};
const sanitizeLines = (values, fallback) => {
    const lines = Array.isArray(values)
        ? values.map((value) => sanitizeText(value)).filter(Boolean)
        : [];
    if (!lines.length && fallback)
        return [fallback];
    return lines;
};
export const formatMoneyIndian = (value) => {
    const rounded = roundCurrency(value);
    const sign = rounded < 0 ? '-' : '';
    const absolute = Math.abs(rounded);
    const [wholePart, decimalPart] = absolute.toFixed(2).split('.');
    const lastThree = wholePart.slice(-3);
    const rest = wholePart.slice(0, -3);
    const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
    return `${sign}${grouped}.${decimalPart}`;
};
export const formatQuantity = (value, unit) => {
    const rounded = Math.abs(value % 1) < 0.000001 ? value.toFixed(0) : value.toFixed(3);
    return unit ? `${rounded} ${sanitizeText(unit)}` : rounded;
};
export const formatInvoiceDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return '-';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fitText = (doc, text, maxWidth, preferredFontSize, minimumFontSize) => {
    let size = preferredFontSize;
    while (size > minimumFontSize) {
        doc.setFontSize(size);
        if (doc.getTextWidth(text) <= maxWidth)
            return size;
        size -= 0.2;
    }
    return minimumFontSize;
};
export const wrapAndClipText = (doc, text, maxWidth, maxLines) => {
    const sanitized = sanitizeText(text);
    const wrapped = doc.splitTextToSize(sanitized, maxWidth).slice(0, maxLines);
    if (!wrapped.length)
        return ['-'];
    if (wrapped.length < maxLines)
        return wrapped;
    const lastIndex = wrapped.length - 1;
    const original = wrapped[lastIndex];
    let clipped = original;
    while (clipped.length > 1 && doc.getTextWidth(`${clipped}...`) > maxWidth)
        clipped = clipped.slice(0, -1).trimEnd();
    wrapped[lastIndex] = clipped === original ? original : `${clipped}...`;
    return wrapped;
};
const setBaseState = (doc) => {
    doc.setTextColor(...COLORS.text);
    doc.setDrawColor(...COLORS.border);
    doc.setFillColor(...COLORS.white);
    doc.setLineWidth(0.18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
};
const drawHLine = (doc, y, x1, x2, width) => {
    doc.setLineWidth(width);
    doc.line(x1, y, x2, y);
};
const drawVLine = (doc, x, y1, y2, width) => {
    doc.setLineWidth(width);
    doc.line(x, y1, x, y2);
};
const drawBox = (doc, x, y, width, height, lineWidth) => {
    doc.setLineWidth(lineWidth);
    doc.rect(x, y, width, height);
};
const drawLabelValueRow = (doc, label, value, xLabel, xValueRight, y, labelStyle = 'normal', valueStyle = 'normal', fontSize = 7.5) => {
    doc.setFont('helvetica', labelStyle);
    doc.setFontSize(fontSize);
    doc.text(label, xLabel, y);
    doc.setFont('helvetica', valueStyle);
    doc.text(value, xValueRight, y, { align: 'right' });
};
const isDataUrl = (value) => /^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(value);
const detectImageFormat = (dataUrl) => (dataUrl.toLowerCase().startsWith('data:image/jpeg') || dataUrl.toLowerCase().startsWith('data:image/jpg')
    ? 'JPEG'
    : 'PNG');
const normalizeRemoteImageToDataUrl = async (source) => {
    try {
        const response = await fetch(source);
        if (!response.ok)
            return null;
        const blob = await response.blob();
        return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    }
    catch {
        return null;
    }
};
const normalizeImageSource = async (source) => {
    const value = sanitizeText(source);
    if (!value)
        return null;
    const dataUrl = isDataUrl(value) ? value : /^https?:\/\//i.test(value) ? await normalizeRemoteImageToDataUrl(value) : null;
    if (!dataUrl || !isDataUrl(dataUrl))
        return null;
    return { dataUrl, format: detectImageFormat(dataUrl) };
};
export const drawContainedImage = async (doc, source, box, horizontalAlign = 'center', verticalAlign = 'center') => {
    const normalized = await normalizeImageSource(source);
    if (!normalized)
        return null;
    try {
        const properties = doc.getImageProperties(normalized.dataUrl);
        const sourceW = Number(properties.width) || 1;
        const sourceH = Number(properties.height) || 1;
        const ratio = sourceW / sourceH;
        let drawW = box.maxWidth;
        let drawH = drawW / ratio;
        if (drawH > box.maxHeight) {
            drawH = box.maxHeight;
            drawW = drawH * ratio;
        }
        const x = horizontalAlign === 'left'
            ? box.x
            : horizontalAlign === 'right'
                ? box.x + box.maxWidth - drawW
                : box.x + ((box.maxWidth - drawW) / 2);
        const y = verticalAlign === 'top'
            ? box.y
            : verticalAlign === 'bottom'
                ? box.y + box.maxHeight - drawH
                : box.y + ((box.maxHeight - drawH) / 2);
        doc.addImage(normalized.dataUrl, normalized.format, x, y, drawW, drawH, undefined, normalized.format === 'PNG' ? 'FAST' : 'MEDIUM');
        return { x, y, width: drawW, height: drawH };
    }
    catch {
        return null;
    }
};
export const calculateTaxSummaryByHsn = (invoice) => {
    const rows = new Map();
    invoice.items.forEach((item) => {
        const hsn = sanitizeText(item.hsn, '-');
        const current = rows.get(hsn) || {
            hsn,
            taxableAmount: 0,
            cgstRate: 0,
            cgstAmount: 0,
            sgstRate: 0,
            sgstAmount: 0,
            igstRate: 0,
            igstAmount: 0,
            taxAmount: 0,
        };
        current.taxableAmount = roundCurrency(current.taxableAmount + roundCurrency(item.taxableAmount));
        current.cgstRate = Math.max(current.cgstRate, Number(item.cgstRate || 0));
        current.cgstAmount = roundCurrency(current.cgstAmount + roundCurrency(item.cgstAmount || 0));
        current.sgstRate = Math.max(current.sgstRate, Number(item.sgstRate || 0));
        current.sgstAmount = roundCurrency(current.sgstAmount + roundCurrency(item.sgstAmount || 0));
        current.igstRate = Math.max(current.igstRate, Number(item.igstRate || 0));
        current.igstAmount = roundCurrency(current.igstAmount + roundCurrency(item.igstAmount || 0));
        current.taxAmount = roundCurrency(current.taxAmount + roundCurrency(Number(item.cgstAmount || 0) + Number(item.sgstAmount || 0) + Number(item.igstAmount || 0)));
        rows.set(hsn, current);
    });
    return Array.from(rows.values());
};
const buildTableColumns = (gstMode) => {
    const { columns } = LAYOUT.itemTable;
    if (gstMode === 'IGST') {
        return [
            { key: 'item', label: 'Item', startX: columns.item[0], endX: columns.item[1], align: 'center' },
            { key: 'hsn', label: 'HSN', startX: columns.hsn[0], endX: columns.hsn[1], align: 'left' },
            { key: 'qty', label: 'Qty', startX: columns.qty[0], endX: columns.qty[1], align: 'center' },
            { key: 'rate', label: 'Rate', startX: columns.rate[0], endX: columns.rate[1], align: 'center' },
            { key: 'discount', label: 'Discount', startX: columns.discount[0], endX: columns.discount[1], align: 'center' },
            { key: 'amount', label: 'Amount', startX: columns.amount[0], endX: columns.amount[1], align: 'center' },
            { key: 'igst', label: 'IGST', startX: columns.taxA[0], endX: columns.taxB[1], align: 'center' },
            { key: 'total', label: 'Total', startX: columns.total[0], endX: columns.total[1], align: 'center' },
        ];
    }
    if (gstMode === 'NONE') {
        return [
            { key: 'item', label: 'Item', startX: columns.item[0], endX: columns.item[1], align: 'center' },
            { key: 'hsn', label: 'HSN', startX: columns.hsn[0], endX: columns.hsn[1], align: 'left' },
            { key: 'qty', label: 'Qty', startX: columns.qty[0], endX: columns.qty[1], align: 'center' },
            { key: 'rate', label: 'Rate', startX: columns.rate[0], endX: columns.rate[1], align: 'center' },
            { key: 'discount', label: 'Discount', startX: columns.discount[0], endX: columns.discount[1], align: 'center' },
            { key: 'amount', label: 'Amount', startX: columns.amount[0], endX: columns.taxB[1], align: 'center' },
            { key: 'total', label: 'Total', startX: columns.total[0], endX: columns.total[1], align: 'center' },
        ];
    }
    return [
        { key: 'item', label: 'Item', startX: columns.item[0], endX: columns.item[1], align: 'center' },
        { key: 'hsn', label: 'HSN', startX: columns.hsn[0], endX: columns.hsn[1], align: 'left' },
        { key: 'qty', label: 'Qty', startX: columns.qty[0], endX: columns.qty[1], align: 'center' },
        { key: 'rate', label: 'Rate', startX: columns.rate[0], endX: columns.rate[1], align: 'center' },
        { key: 'discount', label: 'Discount', startX: columns.discount[0], endX: columns.discount[1], align: 'center' },
        { key: 'amount', label: 'Amount', startX: columns.amount[0], endX: columns.amount[1], align: 'center' },
        { key: 'cgst', label: 'CGST', startX: columns.taxA[0], endX: columns.taxA[1], align: 'center' },
        { key: 'sgst', label: 'SGST', startX: columns.taxB[0], endX: columns.taxB[1], align: 'center' },
        { key: 'total', label: 'Total', startX: columns.total[0], endX: columns.total[1], align: 'center' },
    ];
};
const prepareRenderableItems = (doc, items) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    return items.map((item) => {
        const nameLines = wrapAndClipText(doc, sanitizeText(item.name, '-'), 29, 3);
        const descriptionWrappedLines = (sanitizeLines(item.descriptionLines).flatMap((line) => wrapAndClipText(doc, line, 29, 2))).slice(0, 2);
        const contentLines = nameLines.length + descriptionWrappedLines.length;
        const rowHeight = Math.max(11.5, roundCurrency(5.8 + (contentLines * 3.8)));
        return {
            ...item,
            nameLines,
            descriptionWrappedLines,
            rowHeight,
        };
    });
};
const paginateRenderableItems = (items) => {
    const singlePageCapacity = LAYOUT.itemTable.finalBottom - LAYOUT.itemTable.headerBottom;
    const continuationCapacity = LAYOUT.itemTable.continuationBottom - LAYOUT.itemTable.headerBottom;
    const totalHeight = items.reduce((sum, item) => sum + item.rowHeight, 0);
    if (totalHeight <= singlePageCapacity)
        return [items];
    const reversedPages = [];
    let cursor = items.length;
    let capacity = singlePageCapacity;
    while (cursor > 0) {
        let used = 0;
        const pageItems = [];
        while (cursor > 0) {
            const nextItem = items[cursor - 1];
            if (pageItems.length > 0 && used + nextItem.rowHeight > capacity)
                break;
            pageItems.unshift(nextItem);
            used += nextItem.rowHeight;
            cursor -= 1;
            if (used >= capacity)
                break;
        }
        reversedPages.push(pageItems);
        capacity = continuationCapacity;
    }
    return reversedPages.reverse();
};
const aggregateQuantitySummary = (items) => {
    const unitMap = new Map();
    items.forEach((item) => {
        const unit = sanitizeText(item.unit, 'Qty');
        unitMap.set(unit, roundCurrency((unitMap.get(unit) || 0) + Number(item.quantity || 0)));
    });
    return Array.from(unitMap.entries())
        .map(([unit, quantity]) => `${formatQuantity(quantity).replace(/\s+/g, '')}(${unit})`)
        .join(', ');
};
const numberToIndianWords = (value) => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const twoDigits = (num) => {
        if (num < 10)
            return ones[num];
        if (num < 20)
            return teens[num - 10];
        return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ''}`.trim();
    };
    const threeDigits = (num) => {
        const hundred = Math.floor(num / 100);
        const rest = num % 100;
        return `${hundred ? `${ones[hundred]} Hundred` : ''}${hundred && rest ? ' ' : ''}${rest ? twoDigits(rest) : ''}`.trim();
    };
    const absolute = Math.floor(Math.abs(value));
    if (absolute === 0)
        return 'Zero Rupees Only';
    const crore = Math.floor(absolute / 10000000);
    const lakh = Math.floor((absolute % 10000000) / 100000);
    const thousand = Math.floor((absolute % 100000) / 1000);
    const hundred = absolute % 1000;
    const parts = [
        crore ? `${threeDigits(crore)} Crore` : '',
        lakh ? `${threeDigits(lakh)} Lakh` : '',
        thousand ? `${threeDigits(thousand)} Thousand` : '',
        hundred ? threeDigits(hundred) : '',
    ].filter(Boolean);
    return `${parts.join(' ')} Rupees Only`;
};
const renderFrameAndCommonSections = async (doc, invoice, options, pageNumber, totalPages, isFinalPage) => {
    setBaseState(doc);
    drawBox(doc, LAYOUT.frame.x, LAYOUT.frame.y, LAYOUT.frame.w, LAYOUT.frame.h, 0.35);
    drawHLine(doc, LAYOUT.header.bottom, LAYOUT.frame.x, LAYOUT.frame.right, 0.30);
    drawHLine(doc, LAYOUT.billTo.bottom, LAYOUT.frame.x, LAYOUT.frame.right, 0.30);
    drawVLine(doc, LAYOUT.billTo.dividerX, LAYOUT.billTo.top, LAYOUT.billTo.bottom, 0.30);
    drawHLine(doc, LAYOUT.invoiceMeta.titleBottom, LAYOUT.invoiceMeta.x, LAYOUT.invoiceMeta.right, 0.30);
    await drawContainedImage(doc, invoice.company.logo, LAYOUT.header.logo, 'left', 'center');
    doc.setFont('helvetica', 'bold');
    const companyName = sanitizeText(invoice.company.name, options.missingRequiredDisplayValue);
    const companyFontSize = fitText(doc, companyName, LAYOUT.header.companyName.maxWidth, 16, 12);
    doc.setFontSize(companyFontSize);
    const companyLines = doc.getTextWidth(companyName) <= LAYOUT.header.companyName.maxWidth
        ? [companyName]
        : wrapAndClipText(doc, companyName, LAYOUT.header.companyName.maxWidth, 2);
    doc.text(companyLines, LAYOUT.header.companyName.x, LAYOUT.header.companyName.y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    const addressLines = sanitizeLines(invoice.company.addressLines, options.missingRequiredDisplayValue)
        .flatMap((line) => wrapAndClipText(doc, line, LAYOUT.header.address.maxWidth, 1))
        .slice(0, 2);
    doc.text(addressLines, LAYOUT.header.address.x, LAYOUT.header.address.y, { lineHeightFactor: 1.36 });
    drawLabelValueRow(doc, 'GSTIN:', sanitizeText(invoice.company.gstin, options.missingRequiredDisplayValue), 154.8, LAYOUT.header.taxBlock.right, LAYOUT.header.taxBlock.gstY, 'normal', 'normal', 7.2);
    drawLabelValueRow(doc, 'PAN:', sanitizeText(invoice.company.pan, options.missingRequiredDisplayValue), 154.8, LAYOUT.header.taxBlock.right, LAYOUT.header.taxBlock.panY, 'normal', 'normal', 7.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('Bill To:', LAYOUT.billTo.leftPadding, LAYOUT.billTo.billToLabelY);
    doc.setFontSize(9);
    doc.text(sanitizeText(invoice.customer.name, options.missingRequiredDisplayValue), LAYOUT.billTo.contentX, LAYOUT.billTo.customerNameY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    const customerAddress = sanitizeLines(invoice.customer.addressLines);
    const customerAddressLines = customerAddress.flatMap((line) => wrapAndClipText(doc, line, 120, 1)).slice(0, 3);
    if (customerAddressLines.length)
        doc.text(customerAddressLines, LAYOUT.billTo.contentX, LAYOUT.billTo.addressY, { lineHeightFactor: 1.28 });
    const customerMetaRows = [];
    if (sanitizeText(invoice.customer.mobile))
        customerMetaRows.push({ y: LAYOUT.billTo.mobileY, text: `Mo: ${sanitizeText(invoice.customer.mobile)}` });
    if (sanitizeText(invoice.customer.gstName))
        customerMetaRows.push({ y: LAYOUT.billTo.mobileY + 5.2, text: `GST Name: ${sanitizeText(invoice.customer.gstName)}` });
    const gstPanLine = [
        sanitizeText(invoice.customer.gstNumber) ? `GSTIN: ${sanitizeText(invoice.customer.gstNumber)}` : '',
        sanitizeText(invoice.customer.pan) ? `PAN: ${sanitizeText(invoice.customer.pan)}` : '',
    ].filter(Boolean).join('    ');
    if (gstPanLine)
        customerMetaRows.push({ y: LAYOUT.billTo.gstY, text: gstPanLine });
    customerMetaRows.forEach((row) => {
        const lines = wrapAndClipText(doc, row.text, 120, 1);
        doc.text(lines, LAYOUT.billTo.contentX, row.y);
    });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Invoice', (LAYOUT.invoiceMeta.x + LAYOUT.invoiceMeta.right) / 2, 35.3, { align: 'center' });
    drawLabelValueRow(doc, 'Number:', sanitizeText(invoice.invoiceNumber, options.missingRequiredDisplayValue), 156.8, LAYOUT.invoiceMeta.valueRight, LAYOUT.invoiceMeta.rows.number, 'normal', 'bold', 7.5);
    drawLabelValueRow(doc, 'Date:', formatInvoiceDate(invoice.invoiceDate), 156.8, LAYOUT.invoiceMeta.valueRight, LAYOUT.invoiceMeta.rows.date, 'normal', 'normal', 7.5);
    drawLabelValueRow(doc, 'Place of Supply:', sanitizeText(invoice.placeOfSupply, options.missingRequiredDisplayValue), 156.8, LAYOUT.invoiceMeta.valueRight, LAYOUT.invoiceMeta.rows.placeOfSupply, 'normal', 'normal', 7.5);
    if (totalPages > 1) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        doc.text(`Page ${pageNumber} of ${totalPages}`, LAYOUT.frame.right - 1.5, 295.0, { align: 'right' });
    }
    if (isFinalPage && options.showFooterText && sanitizeText(invoice.footerText)) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(4.8);
        doc.text(sanitizeText(invoice.footerText), LAYOUT.outsideFooter.x, LAYOUT.outsideFooter.y);
    }
};
const drawItemTableSkeleton = (doc, gstMode, bottomY) => {
    const columns = buildTableColumns(gstMode);
    drawHLine(doc, LAYOUT.itemTable.top, LAYOUT.frame.x, LAYOUT.frame.right, 0.30);
    drawHLine(doc, LAYOUT.itemTable.headerBottom, LAYOUT.frame.x, LAYOUT.frame.right, 0.30);
    drawHLine(doc, bottomY, LAYOUT.frame.x, LAYOUT.frame.right, 0.30);
    columns.slice(1).forEach((column) => drawVLine(doc, column.startX, LAYOUT.itemTable.top, bottomY, 0.18));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    columns.forEach((column) => {
        const centerX = (column.startX + column.endX) / 2;
        if (column.key === 'hsn')
            doc.text(column.label, column.startX + 1, 70.6);
        else
            doc.text(column.label, centerX, 70.6, { align: 'center' });
    });
};
const renderItemRows = (doc, items, startIndex, gstMode, bottomY) => {
    let currentY = LAYOUT.itemTable.headerBottom;
    items.forEach((item, localIndex) => {
        const rowTopY = currentY;
        const rowBottomY = rowTopY + item.rowHeight;
        const textTopY = rowTopY + 4.4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.text(String(startIndex + localIndex + 1), LAYOUT.itemTable.serialX, textTopY);
        doc.text(item.nameLines, LAYOUT.itemTable.itemTextX, textTopY, { lineHeightFactor: 1.18 });
        if (item.descriptionWrappedLines.length) {
            doc.setFontSize(6.4);
            doc.text(item.descriptionWrappedLines, LAYOUT.itemTable.itemTextX, textTopY + (item.nameLines.length * 3.75), { lineHeightFactor: 1.1 });
        }
        const qty = formatQuantity(Number(item.quantity || 0), sanitizeText(item.unit));
        const rate = formatMoneyIndian(item.rate);
        const discount = formatMoneyIndian(item.discount);
        const taxable = formatMoneyIndian(item.taxableAmount);
        const total = formatMoneyIndian(item.total);
        const rightText = (x, text) => doc.text(text, x, textTopY, { align: 'right' });
        doc.setFontSize(6.8);
        doc.text(sanitizeText(item.hsn, '-'), LAYOUT.itemTable.columns.hsn[0] + 1.2, textTopY);
        rightText(LAYOUT.itemTable.columns.qty[1] - 1.6, qty);
        rightText(LAYOUT.itemTable.columns.rate[1] - 1.6, rate);
        rightText(LAYOUT.itemTable.columns.discount[1] - 1.6, discount);
        const amountRight = gstMode === 'NONE' ? LAYOUT.itemTable.columns.taxB[1] - 1.6 : LAYOUT.itemTable.columns.amount[1] - 1.6;
        rightText(amountRight, taxable);
        if (gstMode === 'CGST_SGST') {
            doc.setFontSize(6.7);
            doc.text(`${formatMoneyIndian(item.cgstAmount || 0)}\n(${sanitizeText(item.cgstRate, '0')}%)`, (LAYOUT.itemTable.columns.taxA[0] + LAYOUT.itemTable.columns.taxA[1]) / 2, textTopY, { align: 'center', baseline: 'alphabetic' });
            doc.text(`${formatMoneyIndian(item.sgstAmount || 0)}\n(${sanitizeText(item.sgstRate, '0')}%)`, (LAYOUT.itemTable.columns.taxB[0] + LAYOUT.itemTable.columns.taxB[1]) / 2, textTopY, { align: 'center', baseline: 'alphabetic' });
        }
        else if (gstMode === 'IGST') {
            doc.setFontSize(6.7);
            doc.text(`${formatMoneyIndian(item.igstAmount || 0)}\n(${sanitizeText(item.igstRate, '0')}%)`, (LAYOUT.itemTable.columns.taxA[0] + LAYOUT.itemTable.columns.taxB[1]) / 2, textTopY, { align: 'center', baseline: 'alphabetic' });
        }
        doc.setFontSize(6.8);
        rightText(LAYOUT.itemTable.columns.total[1] - 1.6, total);
        drawHLine(doc, Math.min(rowBottomY, bottomY), LAYOUT.frame.x, LAYOUT.frame.right, 0.12);
        currentY = rowBottomY;
    });
    return currentY;
};
const renderQuantityStrip = (doc, invoice) => {
    drawHLine(doc, LAYOUT.quantityStrip.top, LAYOUT.frame.x, LAYOUT.frame.right, 0.30);
    drawHLine(doc, LAYOUT.quantityStrip.bottom, LAYOUT.frame.x, LAYOUT.frame.right, 0.30);
    drawVLine(doc, LAYOUT.itemTable.columns.qty[0], LAYOUT.quantityStrip.top, LAYOUT.quantityStrip.bottom, 0.18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.text('Total qty', LAYOUT.quantityStrip.labelRight, LAYOUT.quantityStrip.baselineY, { align: 'right' });
    const summary = sanitizeText(invoice.quantitySummary) || aggregateQuantitySummary(invoice.items);
    doc.text(summary, LAYOUT.quantityStrip.valueX, LAYOUT.quantityStrip.baselineY);
};
const renderTaxTable = (doc, invoice) => {
    const rows = calculateTaxSummaryByHsn(invoice);
    const totalTax = roundCurrency(Number(invoice.cgstAmount || 0) + Number(invoice.sgstAmount || 0) + Number(invoice.igstAmount || 0));
    const head = invoice.gstMode === 'CGST_SGST'
        ? [['HSN/SAC', 'Taxable Amount', 'CGST', 'SGST', 'Tax Amount']]
        : invoice.gstMode === 'IGST'
            ? [['HSN/SAC', 'Taxable Amount', 'IGST', 'Tax Amount']]
            : [['HSN/SAC', 'Taxable Amount', 'Tax Amount']];
    const body = rows.map((row) => (invoice.gstMode === 'CGST_SGST'
        ? [
            row.hsn,
            formatMoneyIndian(row.taxableAmount),
            `${formatMoneyIndian(row.cgstAmount)} (${sanitizeText(row.cgstRate, '0')}%)`,
            `${formatMoneyIndian(row.sgstAmount)} (${sanitizeText(row.sgstRate, '0')}%)`,
            formatMoneyIndian(row.taxAmount),
        ]
        : invoice.gstMode === 'IGST'
            ? [
                row.hsn,
                formatMoneyIndian(row.taxableAmount),
                `${formatMoneyIndian(row.igstAmount)} (${sanitizeText(row.igstRate, '0')}%)`,
                formatMoneyIndian(row.taxAmount),
            ]
            : [
                row.hsn,
                formatMoneyIndian(row.taxableAmount),
                formatMoneyIndian(row.taxAmount),
            ]));
    body.push(invoice.gstMode === 'CGST_SGST'
        ? ['Total', formatMoneyIndian(invoice.basicAmount), formatMoneyIndian(invoice.cgstAmount || 0), formatMoneyIndian(invoice.sgstAmount || 0), formatMoneyIndian(totalTax)]
        : invoice.gstMode === 'IGST'
            ? ['Total', formatMoneyIndian(invoice.basicAmount), formatMoneyIndian(invoice.igstAmount || 0), formatMoneyIndian(totalTax)]
            : ['Total', formatMoneyIndian(invoice.basicAmount), formatMoneyIndian(totalTax)]);
    autoTable(doc, {
        startY: LAYOUT.summary.taxTable.top,
        margin: { left: LAYOUT.summary.taxTable.x, right: PAGE_W - LAYOUT.summary.taxTable.right },
        tableWidth: LAYOUT.summary.taxTable.right - LAYOUT.summary.taxTable.x,
        head,
        body,
        theme: 'grid',
        styles: {
            font: 'helvetica',
            fontSize: 6.2,
            cellPadding: 0.65,
            lineColor: COLORS.border,
            lineWidth: 0.12,
            textColor: COLORS.text,
            valign: 'middle',
        },
        headStyles: {
            fontStyle: 'normal',
            fillColor: COLORS.white,
            textColor: COLORS.text,
        },
        bodyStyles: { fontStyle: 'normal' },
        columnStyles: invoice.gstMode === 'CGST_SGST'
            ? { 0: { cellWidth: 17 }, 1: { cellWidth: 27, halign: 'right' }, 2: { cellWidth: 34, halign: 'right' }, 3: { cellWidth: 34, halign: 'right' }, 4: { halign: 'right' } }
            : invoice.gstMode === 'IGST'
                ? { 0: { cellWidth: 24 }, 1: { cellWidth: 35, halign: 'right' }, 2: { cellWidth: 42, halign: 'right' }, 3: { halign: 'right' } }
                : { 0: { cellWidth: 28 }, 1: { cellWidth: 48, halign: 'right' }, 2: { halign: 'right' } },
    });
};
const renderSummarySection = (doc, invoice, options) => {
    drawVLine(doc, LAYOUT.summary.dividerX, LAYOUT.summary.top, LAYOUT.summary.bottom, 0.30);
    drawHLine(doc, LAYOUT.summary.taxWords.bottom, LAYOUT.frame.x, LAYOUT.summary.dividerX, 0.30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('Net Payable in Words', LAYOUT.summary.words.x, LAYOUT.summary.words.top);
    doc.setFontSize(6.9);
    const wordsLines = wrapAndClipText(doc, sanitizeText(invoice.netPayableWords, numberToIndianWords(invoice.netPayable)), LAYOUT.summary.words.maxWidth, 3);
    doc.text(wordsLines, LAYOUT.summary.words.x, LAYOUT.summary.words.top + 5.2, { lineHeightFactor: 1.22 });
    renderTaxTable(doc, invoice);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    const taxWords = sanitizeText(invoice.taxAmountWords || (roundCurrency((invoice.cgstAmount || 0) + (invoice.sgstAmount || 0) + (invoice.igstAmount || 0)) > 0
        ? numberToIndianWords((invoice.cgstAmount || 0) + (invoice.sgstAmount || 0) + (invoice.igstAmount || 0))
        : '-'));
    const taxWordsLine = `Tax amount in words: ${taxWords}`;
    doc.text(wrapAndClipText(doc, taxWordsLine, 126, 2), 7.8, LAYOUT.summary.taxWords.baselineY, { lineHeightFactor: 1.12 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('Bank detail', 7.8, 227.7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    const bankRows = [
        ['FOR:', sanitizeText(invoice.bank?.accountFor)],
        ['BANK NAME:', sanitizeText(invoice.bank?.bankName)],
        ['A/C- NO:', sanitizeText(invoice.bank?.accountNumber)],
        ['IFSC:', sanitizeText(invoice.bank?.ifsc)],
        ['BRANCH:', sanitizeText(invoice.bank?.branch)],
        ['UPI:', sanitizeText(invoice.bank?.upiId)],
    ].filter(([, value]) => Boolean(value));
    let bankY = 232.0;
    bankRows.forEach(([label, value]) => {
        doc.text(`${label} ${value}`, 7.8, bankY);
        bankY += 4.3;
    });
    const currency = options.currencySymbol;
    const totals = [
        ['Basic Amount', `${currency} ${formatMoneyIndian(invoice.basicAmount)}`],
        ...(invoice.gstMode === 'CGST_SGST' ? [
            ['CGST', `${currency} ${formatMoneyIndian(invoice.cgstAmount || 0)}`],
            ['SGST', `${currency} ${formatMoneyIndian(invoice.sgstAmount || 0)}`],
        ] : []),
        ...(invoice.gstMode === 'IGST' ? [['IGST', `${currency} ${formatMoneyIndian(invoice.igstAmount || 0)}`]] : []),
        ...(roundCurrency(invoice.roundOff || 0) !== 0 ? [['Round Off', `${currency} ${formatMoneyIndian(invoice.roundOff || 0)}`]] : []),
    ];
    let totalsY = LAYOUT.summary.totals.topY;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.7);
    totals.forEach(([label, value]) => {
        doc.text(label, LAYOUT.summary.totals.labelRight, totalsY, { align: 'right' });
        doc.text(value, LAYOUT.summary.totals.valueRight, totalsY, { align: 'right' });
        totalsY += 8;
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Net payable', LAYOUT.summary.totals.labelRight, totalsY + 1.2, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    const finalAmount = `${currency} ${formatMoneyIndian(invoice.netPayable)}`;
    const payableFont = fitText(doc, finalAmount, 34, 11, 9);
    doc.setFontSize(payableFont);
    doc.text(finalAmount, LAYOUT.summary.totals.valueRight, totalsY + 1.5, { align: 'right' });
};
const renderFooterSection = async (doc, invoice, options) => {
    drawVLine(doc, LAYOUT.footer.termsRight, LAYOUT.footer.top, LAYOUT.footer.bottom, 0.30);
    drawVLine(doc, LAYOUT.footer.receiverRight, LAYOUT.footer.top, LAYOUT.footer.bottom, 0.30);
    drawVLine(doc, LAYOUT.footer.authorizedRight, LAYOUT.footer.top, LAYOUT.footer.bottom, 0.30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('Terms and Conditions', 7.8, 254.0);
    doc.setFont('helvetica', 'normal');
    const terms = (invoice.terms || []).map((term) => sanitizeText(term)).filter(Boolean);
    doc.setFontSize(6.5);
    let currentY = 259.0;
    terms.forEach((term, index) => {
        const lines = wrapAndClipText(doc, `(${index + 1}) ${term}`, 90, 3);
        doc.text(lines, 7.8, currentY, { lineHeightFactor: 1.18 });
        currentY += Math.max(4.4, lines.length * 4.2);
    });
    if (options.showReceiverSignature) {
        await drawContainedImage(doc, invoice.receiverSignatureImage, { x: 106.0, y: 263.0, maxWidth: 24, maxHeight: 14 }, 'center', 'center');
    }
    drawHLine(doc, LAYOUT.footer.receiverLineY, 102.0, 135.8, 0.18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text("Receiver's Signature", (100.8 + 137.2) / 2, LAYOUT.footer.captionY, { align: 'center' });
    if (options.showAuthorizedSignature) {
        await drawContainedImage(doc, invoice.authorizedSignatureImage, { x: 143, y: 262, maxWidth: 31, maxHeight: 18 }, 'center', 'center');
    }
    drawHLine(doc, LAYOUT.footer.authorizedLineY, 138.6, 178.6, 0.18);
    doc.text('Authorised Signature', (137.2 + 180.0) / 2, LAYOUT.footer.captionY, { align: 'center' });
    if (options.showQrCode) {
        await drawContainedImage(doc, invoice.qrCodeImage, { x: 183.1, y: 260.5, maxWidth: 18.5, maxHeight: 18.5 }, 'center', 'center');
    }
};
export async function generateExactTaxInvoicePDF(invoice, options) {
    const resolvedOptions = {
        output: options?.output || 'save',
        fileName: sanitizeText(options?.fileName, `invoice_${sanitizeText(invoice.invoiceNumber, 'document')}.pdf`),
        currencySymbol: sanitizeText(options?.currencySymbol, 'Rs.'),
        showQrCode: options?.showQrCode !== false,
        showReceiverSignature: options?.showReceiverSignature !== false,
        showAuthorizedSignature: options?.showAuthorizedSignature !== false,
        showFooterText: options?.showFooterText !== false,
        missingRequiredDisplayValue: options?.missingRequiredDisplayValue ?? '-',
    };
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
    });
    const renderableItems = prepareRenderableItems(doc, invoice.items || []);
    const pages = paginateRenderableItems(renderableItems);
    const totalPages = pages.length;
    let itemOffset = 0;
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        if (pageIndex > 0)
            doc.addPage('a4', 'portrait');
        const isFinalPage = pageIndex === totalPages - 1;
        await renderFrameAndCommonSections(doc, invoice, resolvedOptions, pageIndex + 1, totalPages, isFinalPage);
        const pageItems = pages[pageIndex];
        const tableBottom = isFinalPage ? LAYOUT.itemTable.finalBottom : LAYOUT.itemTable.continuationBottom;
        drawItemTableSkeleton(doc, invoice.gstMode, tableBottom);
        renderItemRows(doc, pageItems, itemOffset, invoice.gstMode, tableBottom);
        itemOffset += pageItems.length;
        if (isFinalPage) {
            renderQuantityStrip(doc, invoice);
            renderSummarySection(doc, invoice, resolvedOptions);
            await renderFooterSection(doc, invoice, resolvedOptions);
        }
    }
    if (resolvedOptions.output === 'blob')
        return doc.output('blob');
    if (resolvedOptions.output === 'datauristring')
        return doc.output('datauristring');
    doc.save(resolvedOptions.fileName);
}
export const sampleExactTaxInvoiceData = {
    company: {
        name: 'MAHALAXMI TRADELINK',
        addressLines: ['Shop No. 12, Grain Market Road, Rajkot - 360001', 'Gujarat, India'],
        mobile: '+91 98765 43210',
        email: 'billing@mahalaxmitradelink.in',
        gstin: '24ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        state: 'Gujarat',
    },
    customer: {
        name: 'Shree Annapurna Foods',
        addressLines: ['Plot 44, Industrial Estate Phase II', 'Near Highway Circle, Morbi - 363642', 'Warehouse Gate 3'],
        mobile: '+91 99887 77665',
        gstName: 'Shree Annapurna Foods LLP',
        gstNumber: '24AAKFS1234C1Z6',
        pan: 'AAKFS1234C',
    },
    invoiceNumber: 'INV-2026-07124',
    invoiceDate: '2026-07-24T00:00:00.000Z',
    placeOfSupply: 'Gujarat',
    gstMode: 'CGST_SGST',
    items: [
        {
            name: 'Premium Groundnut Oil Tin 15 Ltr',
            descriptionLines: ['Filtered edible oil batch GR-15-24'],
            hsn: '1514',
            quantity: 120,
            unit: 'Pcs',
            rate: 1475,
            discount: 1500,
            taxableAmount: 175500,
            cgstRate: 2.5,
            cgstAmount: 4387.5,
            sgstRate: 2.5,
            sgstAmount: 4387.5,
            total: 184275,
        },
        {
            name: 'Refined Wheat Flour 30 Kg Bags',
            descriptionLines: ['Fresh milling lot WH-30A'],
            hsn: '1101',
            quantity: 80,
            unit: 'Pcs',
            rate: 980,
            discount: 800,
            taxableAmount: 77600,
            cgstRate: 2.5,
            cgstAmount: 1940,
            sgstRate: 2.5,
            sgstAmount: 1940,
            total: 81480,
        },
        {
            name: 'Rock Salt Crystals',
            descriptionLines: ['Food grade bulk supply'],
            hsn: '2501',
            quantity: 260,
            unit: 'Kg',
            rate: 42,
            discount: 0,
            taxableAmount: 10920,
            cgstRate: 2.5,
            cgstAmount: 273,
            sgstRate: 2.5,
            sgstAmount: 273,
            total: 11466,
        },
    ],
    totalQuantity: 460,
    quantitySummary: '200(Pcs), 260(Kg)',
    basicAmount: 264020,
    cgstAmount: 6600.5,
    sgstAmount: 6600.5,
    netPayable: 277221,
    roundOff: 0,
    netPayableWords: 'Two Lakh Seventy Seven Thousand Two Hundred Twenty One Rupees Only',
    taxAmountWords: 'Thirteen Thousand Two Hundred One Rupees Only',
    bank: {
        accountFor: 'Mahalaxmi Tradelink',
        bankName: 'State Bank of India',
        accountNumber: '123456789012',
        ifsc: 'SBIN0001234',
        branch: 'Rajkot Main',
        upiId: 'mahalaxmi@oksbi',
    },
    terms: [
        'Goods once sold will not be taken back without prior written approval.',
        'Please verify quantity and packing before signing delivery acknowledgement.',
        'Interest at 18% per annum may apply on overdue balances.',
    ],
    footerText: 'Generated from internal demo build',
};
export const generateExactTaxInvoicePdfDemo = async (options) => (generateExactTaxInvoicePDF(sampleExactTaxInvoiceData, {
    output: 'save',
    fileName: 'exact-tax-invoice-demo.pdf',
    ...options,
}));
