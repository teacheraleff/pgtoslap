// Este código roda como uma Netlify Function (Node.js) e serve como servidor seguro.
// Ele é responsável por:
// 1. Receber os dados do checkout (preço final, cupom, dados do cliente).
// 2. Usar a ASAAS_API_KEY (Variável de Ambiente SECRETA) para falar com a API do Asaas.
// 3. Montar o payload de cobrança.
// 4. Retornar o link de pagamento ou a mensagem de erro para o front-end.

const fetch = require('node-fetch');

// A CHAVE DE API SECRETA é carregada da Variável de Ambiente configurada no Netlify.
// ESTA CHAVE NUNCA DEVE SER EXPOSTA NO CÓDIGO DO CLIENTE (index.html).
const ASAAS_API_KEY = process.env.ASAAS_API_KEY; 
const ASAAS_API_URL = 'https://sandbox.asaas.com/api/v3'; // URL de TESTE (Sandbox)

exports.handler = async (event, context) => {
    // A função só aceita requisições POST.
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Método não permitido.' }) };
    }

    // 1. Validação Básica da Chave
    if (!ASAAS_API_KEY) {
        console.error("ASAAS_API_KEY não configurada nas variáveis de ambiente do Netlify.");
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'Erro de configuração do servidor: Chave Asaas não encontrada.' }),
        };
    }

    let payload;
    try {
        // Tenta parsear o corpo da requisição JSON do front-end
        payload = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ success: false, message: 'JSON inválido no corpo da requisição.' }) };
    }

    const { customer, payment } = payload;
    
    // Asaas é rígido com a formatação: CPF/CNPJ deve ser apenas números
    const cleanCpfCnpj = customer.cpfCnpj ? customer.cpfCnpj.replace(/\D/g, '') : '';
    
    // O valor deve ser pelo menos 0.01 para gerar a cobrança (se o cupom deixar zero, colocamos 0.01)
    const finalValue = payment.value > 0 ? payment.value : 0.01;
    
    // 2. Montagem do Payload para o Asaas
    const asaasPayload = {
        // CORREÇÃO FINAL: Usamos o nome do cliente no campo 'customer' para a criação simplificada.
        // O Asaas usa o nome como uma referência para criar o cliente se o ID não for passado.
        customer: customer.name, 
        billingType: payment.billingType,
        value: finalValue,
        dueDate: payment.dueDate,
        description: payment.description,
        
        // Dados do Cliente (Customer Data) - Usados para criação/consulta de cliente
        // Mesmo que a cobrança seja gerada diretamente, esses dados são necessários
        externalReference: 'SLAP-CHCKOUT-REF',
        name: customer.name,
        email: customer.email,
        cpfCnpj: cleanCpfCnpj,
        
        // Dados adicionais exigidos
        dateOfBirth: customer.dateOfBirth, // Formato AAAA-MM-DD
        
        // Lógica de Parcelamento (Se for Cartão de Crédito)
        ...(payment.billingType === 'CREDIT_CARD' && {
            installmentCount: payment.installmentCount,
            // ESSA CORREÇÃO GARANTE QUE O VALOR DA PARCELA É ENVIADO:
            installmentValue: payment.installmentValue,
            // IMPORTANTE: Para cartão, o Asaas exige o ID do cliente criado previamente,
            // mas estamos usando um fluxo simplificado para gerar a fatura.
        }),
    };

    console.log("Payload enviado para Asaas:", asaasPayload);

    // 3. Chamada à API do Asaas
    try {
        const response = await fetch(`${ASAAS_API_URL}/payments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'access_token': ASAAS_API_KEY,
            },
            body: JSON.stringify(asaasPayload),
        });

        const asaasData = await response.json();
        
        // Se a resposta do Asaas não for 200/201 (Sucesso), ele retorna um objeto de erro
        if (response.status !== 200 && response.status !== 201) {
            console.error("Erro detalhado do Asaas:", asaasData.errors);
            const errorMessage = asaasData.errors && asaasData.errors.length > 0 
                ? asaasData.errors.map(err => `${err.description}`).join(' | ')
                : 'Erro desconhecido na API do Asaas.';
            
            return {
                statusCode: response.status,
                body: JSON.stringify({ success: false, message: `Erro ao gerar cobrança: ${errorMessage}` }),
            };
        }

        // 4. Sucesso: Retorna o link de pagamento
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Cobrança criada com sucesso.',
                paymentMethod: asaasData.billingType,
                invoiceUrl: asaasData.invoiceUrl,
            }),
        };

    } catch (error) {
        console.error('Erro de rede ou servidor:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: `Erro interno do servidor: ${error.message}` }),
        };
    }
};
