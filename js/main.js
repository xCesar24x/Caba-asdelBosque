document.addEventListener('DOMContentLoaded', () => {
    
    // --- Navbar Scroll Effect ---
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // --- Intersection Observer for Fade-Up Animations ---
    const fadeElements = document.querySelectorAll('.fade-up');
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };
    
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    fadeElements.forEach(el => observer.observe(el));

    // --- Initialize Swiper Gallery ---
    const swiper = new Swiper('.gallery-swiper', {
        effect: 'coverflow',
        grabCursor: true,
        centeredSlides: true,
        slidesPerView: 'auto',
        coverflowEffect: {
            rotate: 20,
            stretch: 0,
            depth: 200,
            modifier: 1,
            slideShadows: true,
        },
        loop: true,
        navigation: {
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
        },
        pagination: {
            el: '.swiper-pagination',
            clickable: true,
        },
        autoplay: {
            delay: 3500,
            disableOnInteraction: false,
        }
    });

    // --- Initialize Pricing Variables and Helpers ---
    let pricingData = { basePrice: 25000, customPrices: {} };

    // Format dates to YYYY-MM-DD for the API
    const formatForAPI = (date) => {
        const d = new Date(date);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().split('T')[0];
    };

    const getPriceForDate = (dateStr) => {
        if (pricingData.customPrices && pricingData.customPrices[dateStr]) {
            return Number(pricingData.customPrices[dateStr]);
        }
        return pricingData.basePrice;
    };

    const formatPriceShort = (price) => {
        if (price >= 1000) {
            return `₡${Math.round(price / 1000)} k`;
        }
        return `₡${price}`;
    };

    const formatCurrency = (val) => {
        return `₡${Number(val).toLocaleString('es-CR')}`;
    };

    // --- Initialize Flatpickr (Calendar) ---
    // Using inline mode to match the visual reference of the booking card
    const datePicker = flatpickr("#datePicker", {
        inline: true,
        mode: "range",
        minDate: "today",
        locale: "es", // Spanish locale
        showMonths: 1,
        disableMobile: true, // Forces custom UI on mobile
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const dateStr = formatForAPI(dayElem.dateObj);
            const price = getPriceForDate(dateStr);
            const priceStr = formatPriceShort(price);
            
            const priceEl = document.createElement("span");
            priceEl.className = "flatpickr-day-price";
            priceEl.innerText = priceStr;
            dayElem.appendChild(priceEl);
        },
        onChange: function(selectedDates, dateStr, instance) {
            const previewEl = document.getElementById('pricePreview');
            if (selectedDates.length === 2) {
                const start = selectedDates[0];
                const end = selectedDates[1];
                
                let total = 0;
                let nightsCount = 0;
                let current = new Date(start);
                
                let explanationHtml = '';
                
                while (current < end) {
                    const currentStr = formatForAPI(current);
                    const price = getPriceForDate(currentStr);
                    total += price;
                    nightsCount++;
                    
                    explanationHtml += `
                        <div class="price-preview-row">
                            <span>Noche ${nightsCount} (${current.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}):</span>
                            <span>${formatCurrency(price)}</span>
                        </div>
                    `;
                    
                    current.setDate(current.getDate() + 1);
                }
                
                previewEl.innerHTML = `
                    <div class="price-preview-title">
                        <i class="fa-solid fa-calculator"></i> Cotización Estimada
                    </div>
                    ${explanationHtml}
                    <div class="price-preview-total">
                        <span>Total (${nightsCount} ${nightsCount === 1 ? 'Noche' : 'Noches'}):</span>
                        <span>${formatCurrency(total)}</span>
                    </div>
                `;
                previewEl.style.display = 'block';
            } else {
                previewEl.style.display = 'none';
                previewEl.innerHTML = '';
            }
        }
    });

    // Fetch blocked dates and pricing from backend
    fetch('/api/bookings')
        .then(response => response.json())
        .then(data => {
            if (data.pricing) {
                pricingData = data.pricing;
            }
            if (data.blockedDates && data.blockedDates.length > 0) {
                datePicker.set('disable', data.blockedDates);
            }
            datePicker.redraw();
        })
        .catch(error => console.error('Error fetching bookings data:', error));

    // --- Form Submit Logic (Mailto / WhatsApp mapping) ---
    const bookingForm = document.getElementById('bookingForm');
    
    bookingForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value;
        const whatsapp = document.getElementById('whatsapp').value;
        const email = document.getElementById('email').value;
        const guests = document.getElementById('guests').value;
        const selectedDates = datePicker.selectedDates;

        if (selectedDates.length < 2) {
            alert('Por favor, selecciona tu fecha de Check-in y Check-out en el calendario.');
            return;
        }

        // Format dates to YYYY-MM-DD for the API
        const formatForAPI = (date) => {
            const d = new Date(date);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            return d.toISOString().split('T')[0];
        };
        
        const checkInAPI = formatForAPI(selectedDates[0]);
        const checkOutAPI = formatForAPI(selectedDates[1]);

        const submitBtn = bookingForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PROCESANDO...';
        submitBtn.disabled = true;

        fetch('/api/bookings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name,
                whatsapp,
                email,
                guests,
                checkIn: checkInAPI,
                checkOut: checkOutAPI
            })
        })
        .then(response => {
            if (!response.ok) throw new Error('Error en la reserva');
            return response.json();
        })
        .then(data => {
            // Build prefilled WhatsApp message
            const messageText = `¡Hola! Me gustaría confirmar mi solicitud de reserva en Cabañas del Bosque:\n\n` +
                                `• *Nombre:* ${name}\n` +
                                `• *WhatsApp/Tel:* ${whatsapp}\n` +
                                `• *Correo:* ${email}\n` +
                                `• *Huéspedes:* ${guests}\n` +
                                `• *Fecha de Entrada:* ${checkInAPI}\n` +
                                `• *Fecha de Salida:* ${checkOutAPI}\n\n` +
                                `¡Muchas gracias!`;
            const encodedText = encodeURIComponent(messageText);
            const whatsappUrl = `https://wa.me/50688225220?text=${encodedText}`;

            alert('¡Reserva solicitada exitosamente en el sistema! Te estamos redirigiendo a WhatsApp para enviar los detalles de tu confirmación de inmediato.');
            
            bookingForm.reset();
            datePicker.clear();

            // Open WhatsApp to send confirmation
            window.location.href = whatsappUrl;
        })
        .catch(error => {
            console.error('Error submitting form:', error);
            alert('Hubo un error al procesar tu reserva. Por favor intenta de nuevo.');
        })
        .finally(() => {
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        });
    });
});
