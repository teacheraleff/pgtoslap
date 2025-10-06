const fetch = require('node-fetch');

// A CHAVE DE API SECRETA É LIDA AQUI PELA VARIÁVEL DE AMBIENTE DO NETLIFY
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
// Usando a URL de Sandbox (Teste) por padrão (conforme você configurou)
const ASAAS_API_URL = 'https://sandbox.asaas.com/api/v3'; 

// Este é o manipulador da função Netlify que recebe o POST do seu checkout.
exports.handler = async (event, context) => {
    // A função só aceita requisições POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: "Método Não Permitido." }),
        };
    }
    
    // Verifica se a chave secreta existe
    if (!ASAAS_API_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Erro de Configuração: ASAAS_API_KEY não está definida nas Variáveis de Ambiente do Netlify." }),
        };
    }

    try {
        const payload = JSON.parse(event.body);
        const { customer, payment } = payload;
        
        // --- 1. PROCURAR OU CRIAR CLIENTE (MELHOR PRÁTICA DO ASAAS) ---
        let customerId;
        const customerSearchResponse = await fetch(`${ASAAS_API_URL}/customers?cpfCnpj=${customer.cpfCnpj}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'access_token': ASAAS_API_KEY,
            },
        });
        const searchData = await customerSearchResponse.json();

        if (searchData.data && searchData.data.length > 0) {
            // Cliente encontrado
            customerId = searchData.data[0].id;
        } else {
            // Cliente não encontrado, precisa criar
            const customerCreationResponse = await fetch(`${ASAAS_API_URL}/customers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'access_token': ASAAS_API_KEY,
                },
                body: JSON.stringify({
                    name: customer.name,
                    email: customer.email,
                    cpfCnpj: customer.cpfCnpj,
                    mobilePhone: '41991234567', // Placeholder
                    dateOfBirth: customer.dateOfBirth, 
                }),
            });

            const customerData = await customerCreationResponse.json();

            if (customerData.errors) {
                // Se o Asaas recusar a criação do cliente
                throw new Error(`Erro ao criar cliente: ${customerData.errors[0].description}`);
            }
            customerId = customerData.id;
        }

        // --- 2. CRIAR A COBRANÇA (PAGAMENTO) ---

        const paymentPayload = {
            customer: customerId,
            billingType: payment.billingType,
            value: payment.value,
            dueDate: payment.dueDate,
            description: payment.description,
            installmentCount: payment.installmentCount,
            externalReference: `SLAP-Checkout-${Date.now()}`,
        };

        const paymentCreationResponse = await fetch(`${ASAAS_API_URL}/payments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'access_token': ASAAS_API_KEY,
            },
            body: JSON.stringify(paymentPayload),
        });

        const paymentData = await paymentCreationResponse.json();

        if (paymentData.errors) {
             // Se o Asaas recusar a criação do pagamento
            throw new Error(`Erro ao gerar cobrança: ${paymentData.errors[0].description} (Parâmetro: ${paymentData.errors[0].param})`);
        }
        
        // --- 3. RETORNAR SUCESSO AO CLIENTE ---

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: true,
                paymentMethod: payment.billingType,
                invoiceUrl: paymentData.invoiceUrl, // Link para o cliente pagar
                amount: paymentData.value,
            }),
        };

    } catch (error) {
        console.error("ERRO CRÍTICO NO BACKEND:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                success: false,
                message: error.message || "Erro interno ao processar a requisição." 
            }),
        };
    }
};
